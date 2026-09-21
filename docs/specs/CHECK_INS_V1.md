# Habit Check-ins v1

Status: Proposed
Date: September 14, 2026
Scope: A named, repeating commitment and a per-day record of whether it happened

## Purpose

Dayflow already records what a day *was*: `DiaryEntry` holds one row per day
with content, reflection, mood and energy, and the bootstrap read model already
rolls seven days of tasks, diaries and activities into a per-day strip. What it
cannot record is a **named commitment that repeats** — "stretch every morning" —
and whether it happened on a given day.

This specification adds that, and nothing else. It does not add recurring tasks.
`Task.date` is a single nullable date and there is no recurrence rule anywhere in
the tree; introducing one would change task counts, the focus queue and the
seven-day statistics, which is a far larger change than recording a habit.

## v1 Scope

- Create, rename, reorder and archive a Habit.
- Record a Check-in for a Habit on a given day: done or not done, with an
  optional number and an optional note.
- Show today's Habits and their state on the Today page.
- Show consistency over the current review period, computed against the Habit's
  cadence rather than against raw day count.

## Record and Cadence Semantics

A **Habit** is a definition. It has a name, a cadence, a status and a sort
order. It is never a record of anything that happened.

A **Check-in** is evidence. It belongs to exactly one Habit, names exactly one
day, and states whether the Habit happened that day. `@@unique([habitId, date])`
makes "one Check-in per Habit per day" a database invariant rather than a
convention, following `DiaryEntry.date @unique` and
`Review.@@unique([periodStart, periodEnd])`.

Cadence has two forms in v1:

- **`DAILY`** — the default. The target is every day.
- **`TIMES_PER_WEEK`** — a target count within the review period, on any days.

Both are stored as `targetPerWeek`, where `DAILY` is the value 7. Keeping one
integer means consistency is one calculation, not two.

`date` is the start of the local day, taken from the injected calendar. Server
code may not read the system clock directly: `CLOCK_READ_ALLOWLIST` holds
exactly one entry, and adding another is a ratchet violation.

## What Absence Means

**A missing Check-in row means "not recorded". It does not mean "not done".**

A row exists only when the user records something, and `done` may be `false`, so
"I did not do it" is expressible and is distinguishable from silence.

This is the load-bearing decision in this specification, and it is not
symmetric. Treating absence as failure bakes an opinion into storage that can
never be undone: a week away from Dayflow becomes indistinguishable from a week
of genuine misses, permanently. The reverse is always available — a read model
may treat absence as a miss whenever it wants — so recording explicitly loses
nothing and preserves the ability to change the rule later.

Two further reasons:

- For a `TIMES_PER_WEEK` Habit a per-day miss is not a meaningful event at all.
  Only the period total is. Absence-as-failure would compute something that does
  not exist for those Habits.
- Recording is bounded by a backfill window. If absence also meant failure, a day
  the user merely forgot to record would become permanently uncorrectable once
  that window closed.

**Dayflow must not manufacture "missed" rows.** The only background runner in the
tree, `startAutomaticBackupRunner`, executes on an interval while the server is
running and computes what is *due* from stored timestamps. A runner of that shape
cannot distinguish "the user missed this day" from "Dayflow was not running", so
materialising misses would fabricate failures for exactly the days the user was
away.

## Recording and Backfill

A Check-in may be recorded for today or for any of the **seven** preceding days.
Earlier days are refused; the record is closed, not silently discarded.

Recording is an upsert keyed by `(habitId, date)`, mirroring `upsertDiary`, so
repeating the same action is naturally idempotent. Mutations carry
`X-Dayflow-Mutation-Id` and pass through `runOnce` like every other write.

`date` — the day the Check-in counts for — and `createdAt` — when it was
recorded — are separate columns. A Check-in recorded three days late remains
identifiable as such, which keeps an honest streak computable later without a
migration.

A Check-in may be recorded against an `ARCHIVED` Habit only within the backfill
window, so archiving never destroys the ability to correct the recent past.

## Archival

A Habit is archived, never deleted. Archiving sets `status = ARCHIVED` and
`archivedAt`, hides it from Today, and leaves every Check-in intact.

**v1 exposes no delete route.** Deleting a definition would take its history with
it, and that is the one irreversible mistake available in this feature. A user
who wants a Habit gone archives it; a user who wants the data gone uses the
existing export and backup tooling.

## Consistency

Consistency is computed per Habit over the current review period as
`done Check-ins ÷ target`.

The target depends on the cadence, because the two cadences mean different
things:

- A **`DAILY`** Habit's target is the number of days of the period that are in
  scope. Three days in, the target is three. A day that has not happened yet
  cannot have been missed, and neither can a day before the Habit existed.
- A **`TIMES_PER_WEEK`** Habit keeps its weekly goal for the whole period. Those
  days may be used in any order and the week is not over, so clipping the target
  to elapsed days would demand three runs by Wednesday from a Habit that only
  promised three by Sunday.

An unrecorded day therefore lowers a daily Habit's ratio, exactly as a recorded
miss would. That is a presentation rule, not a storage one, and the two are
still held apart where it matters: every day carries one of four states —
`done`, `notDone`, `unrecorded`, `outOfScope` — and the UI must not render
`unrecorded` and `notDone` identically.

An earlier draft of this section said an unrecorded day "contributes nothing to
either side of that ratio", which contradicted the clipped target in the same
paragraph. The rule above replaces it.

Streaks are deliberately absent from v1. A streak is a presentation rule layered
on this data, and the data supports several. Choosing one before the record exists
would freeze the weakest part of the design first.

## Reliability and Error Contract

All errors use the existing `AppError` catalog shape for this boundary.

Field validation follows the boundary's existing convention: status 400, code
`VALIDATION_ERROR`, and the offending `field`. Only the absent-record case
carries a code of its own.

| Condition | Status | Code | Field |
| --- | --- | --- | --- |
| Habit name blank, not text, or over 120 characters | 400 | `VALIDATION_ERROR` | `name` |
| Cadence is not `DAILY` or `TIMES_PER_WEEK` | 400 | `VALIDATION_ERROR` | `cadence` |
| `targetPerWeek` outside 1–7 | 400 | `VALIDATION_ERROR` | `targetPerWeek` |
| Check-in date is not a calendar date | 400 | `VALIDATION_ERROR` | `date` |
| Check-in date is in the future | 400 | `VALIDATION_ERROR` | `date` |
| Check-in date is outside the backfill window | 400 | `VALIDATION_ERROR` | `date` |
| `done` is not a boolean | 400 | `VALIDATION_ERROR` | `done` |
| Amount is negative or not a whole number | 400 | `VALIDATION_ERROR` | `amount` |
| Note is not text or over 2,000 characters | 400 | `VALIDATION_ERROR` | `note` |
| Habit not found | 404 | `HABIT_NOT_FOUND` | — |

A daily Habit's target is normalised to 7 rather than rejected, so sending a
cadence of `DAILY` with a target of 3 is accepted and stored as 7. A patch that
switches a Habit to `DAILY` corrects the stored target in the same write, so no
Habit can claim a cadence its target contradicts.

Validation happens before storage is opened, so an invalid request returns its
error even when the database is unavailable — the rule already followed by
`readJournalHistory` and `saveReview`.

Every transaction opens through `withTransaction` from `src/server/prisma/client`.
Rule 6 confines `$transaction` to that module and Rule 10 confines its callers to
`src/app/api` and `src/server`.

## Storage and Migration

```prisma
enum HabitCadence { DAILY TIMES_PER_WEEK }
enum HabitStatus  { ACTIVE ARCHIVED }

model Habit {
  id            String       @id @default(cuid())
  name          String
  cadence       HabitCadence @default(DAILY)
  targetPerWeek Int          @default(7)
  status        HabitStatus  @default(ACTIVE)
  sortOrder     Int          @default(0)
  archivedAt    DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  checkIns      HabitCheckIn[]
}

model HabitCheckIn {
  id        String   @id @default(cuid())
  habitId   String
  date      DateTime
  done      Boolean  @default(true)
  amount    Int?
  note      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  habit     Habit    @relation(fields: [habitId], references: [id], onDelete: Cascade)

  @@unique([habitId, date])
  @@index([date])
}
```

Both models live in the **`evidence`** module. A Check-in is a record of what
happened, which is what `evidence` holds, and the module graph already carries
`review → evidence`, so review gains Habit consistency with no new edge. A
dedicated `habits` module would require a `MODULE_EDGES` change and buy nothing.

A Check-in must never write `ActivityEntry`. `ACTIVITY_WRITE_ALLOWLIST` may
relocate entries but never gain them.

Three consequences that are easy to miss and are not optional:

1. **`src/modules/data-ops/services/sqlite-backup-engine.ts` enumerates table
   names as literals** — 56 of them, plus an explicit referential-integrity list.
   Both new tables must be added there, or backup and restore silently drop every
   Habit and Check-in.
2. **`prisma/init.sql` must be regenerated.** Every integration test builds its
   scratch database from that file.
3. A migration under `prisma/migrations/` with backup and restore coverage, per
   the standing rule that schema changes carry both.

## Accessibility and Responsive Behavior

Each Habit row on Today is a labelled control reachable by keyboard, with its
state conveyed by text or `aria` state and not by colour alone. The optional
amount field is a separate labelled input, not an overload of the toggle. At
phone width the list stacks to one column and keeps a minimum 16px side gutter.

## Today Card Interactions (Stage 2 Implementation)

The Today page renders a dedicated Habits card (`HabitsCard`), supporting direct interaction with today's commitments:

- **Creation with Cadence & Target**: Inline composer with a "New habit name" text input, a cadence selector (`DAILY` or `TIMES_PER_WEEK`), and an adjustable weekly target (1–7). Client-side response decoders enforce that the confirmed cadence and normalized target (7 for `DAILY`) match the request before accepting the newly created row.
- **Inline Rename**: Triggered via a row-level "Rename" button, entering an autofocus inline form. Cancel and Escape dismiss the form and restore focus to the row's Rename button. Form submission is isolated via an editor-generation token and active habit tracking, guaranteeing that delayed server responses cannot close or inject errors into another habit's active editor. Validation errors (e.g. names exceeding 120 characters) retain the user's draft in place.
- **Archive Confirmation & Focus Recovery**: The "Archive" button opens a focus-trapped confirmation modal (`<section role="alertdialog">`). Escape and "Keep habit" dismiss the modal and restore focus to the trigger. Confirming archive removes the row from the card immediately upon confirmed write success without waiting for trailing refresh, and explicitly shifts focus to the next habit's toggle button, the previous habit's toggle button, or the "New habit name" input if all habits have been removed.
- **Today's Check-in Record**: A primary toggle button where `aria-pressed` is boolean (`true` when done, `false` otherwise) and visible button text explicitly conveys state and absence (`"done today"`, `"not done today"`, and `"not recorded today"`). For unrecorded habits, an accessible "Mark not done" action allows recording `done: false` directly in a single request without first marking done, while the primary toggle records `done: true`; once recorded, the toggle switches between done and not done. Check-in mutations track independent busy states per habit ID, preventing concurrent actions on separate habits from locking one another out.
- **Amount & Note Editing**: Amount (integer `0–1,000,000`) and note (textarea, `rows={2}`, max 2,000 characters) fields remain disabled until the habit is recorded today. An independent "Save details" action commits changes; clearing an amount field sends `null`, and clearing a note field sends `null`, persisting the removal in storage.
- **Confirmed-Write & Read-Refresh Feedback**: A confirmed write updates local UI state immediately, but the action stays pending while `useHabitActions` awaits a trailing read-refresh (`refreshAfterConfirmedMutation`). If the trailing refresh fails, the confirmed write is preserved in the card and an announcement or retry toast is presented.
- **Cross-Midnight Protection**: `HabitsCard` and its rows require a `todayKey: string` property and key each row item by `${habit.id}:${todayKey}`. Day-scoped drafts, errors, and touched flags reset across calendar boundaries, ensuring uncommitted drafts from yesterday cannot leak into the new day's editor.

## Scope and Open Policy Tensions (Q1/Q2)

- **v1 Scope Boundaries**: Habit reordering (`sortOrder` manipulation) and historical backfill beyond the Today card (e.g. multi-day retro-logging) remain part of the intended v1 feature scope, but are intentionally out of scope for the Stage 2 Today-card PR.
- **Q1 Pre-Creation Backfill Policy**: Section *Recording and Backfill* permits recording a Check-in for "today or for any of the seven preceding days", while Section *Consistency* states that "neither can a day before the Habit existed" be counted as a miss. The policy for whether a check-in recorded for a date prior to the habit's creation counts toward completion or is rejected remains an unresolved interpretation question, rather than a direct spec contradiction.
- **Q2 Clipped vs. Fixed Weekly Target Interpretation**: Section *Consistency* states that a `TIMES_PER_WEEK` habit "keeps its weekly goal for the whole period" without clipping to elapsed days (e.g. Wednesday of an active week). Meanwhile, the summary calculation (`summarizeHabits`) clamps targets to countable in-scope days of the review period (`Math.min(targetPerWeek, countableDays)`). Because these rules concern different scopes, how they interact for partial periods remains an unresolved interpretation question, rather than contradictory wording.

## Non-Goals

- **Specific weekdays** ("Mon/Wed/Fri"). That needs a weekday set and makes
  per-day misses meaningful again, which changes both the schema and the meaning
  of absence. It is a separate specification.
- Streaks, badges or any gamification.
- Reminders or notifications. Dayflow has no notification surface.
- Materialised "missed" rows, for the reason given above.
- Recurring tasks. Unchanged and out of scope.
- Per-habit timezones. The existing local-day rule applies.

## Required Test Coverage

- The `(habitId, date)` uniqueness invariant holds under concurrent recording,
  proved against a seeded conflict rather than asserted.
- Recording twice with the same mutation id replays one response and leaves one
  row, matching the existing idempotency tests.
- A Check-in dated one day outside the backfill window is refused with
  `VALIDATION_ERROR`, and one day inside it succeeds. The pair is the
  negative control; neither test is meaningful alone.
- An unrecorded day and an explicit `done: false` produce different read-model
  output. A test that cannot tell them apart would pass under the rejected design
  and must fail here.
- Archiving a Habit preserves every Check-in and removes it from Today.
- Consistency for a `TIMES_PER_WEEK` Habit ignores which days were used, and
  never counts days before the Habit existed.
- Validation errors are returned with storage unavailable.
- Backup and restore round-trip both tables with their rows intact — the control
  for consequence 1 above, which otherwise fails silently.
