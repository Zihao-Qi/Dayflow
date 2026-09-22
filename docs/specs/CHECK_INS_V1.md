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
- Show today's Habits and act on them directly on the Today page as an active
  commitments card. Journal remains a dedicated destination for long-form
  entries and reflection; Habits do not reside in Journal or depend on diary
  placement.
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
Together with today, this backfill window encompasses exactly **eight** writable
calendar dates (`today - 7` through `today`). Earlier days and future dates are
refused with status 400 and code `VALIDATION_ERROR`; the record is closed, not
silently discarded.

Recording is an upsert keyed by `(habitId, date)`, mirroring `upsertDiary`, so
repeating the same action is naturally idempotent. Mutations carry
`X-Dayflow-Mutation-Id` and pass through `runOnce` like every other write.

`date` — the day the Check-in counts for — and `createdAt` — when it was
recorded — are separate columns. A Check-in recorded three days late remains
identifiable as such, which keeps an honest streak computable later without a
migration.

**Explicit Evidence Policy**: Any Check-in recorded within the permitted
eight-day window is canonical Evidence, even if dated before the Habit's
local creation day or after its local archival day. If the user explicitly
records a Check-in on a date, that row adds the unique local calendar day to
Habit Target Capacity; if recorded as `done: true`, it also increments
`doneCount` (completion), whereas an explicit `done: false` adds capacity
without incrementing completion. The user's direct report of what occurred is
honored.

**Absence Outside Lifetime**: Conversely, missing days outside a Habit's
lifetime (local calendar days before its local creation day or after its local
archival day with no Check-in row) remain `outOfScope`. Unrecorded silence
outside a Habit's active existence is neither an obligation nor a failure: it is
never classified as `unrecorded` or missed, and does not consume target capacity.

A Check-in may be recorded against an `ARCHIVED` Habit within the eight-day
backfill window, so archiving never destroys the ability to correct the recent
past.

## Archival

A Habit is archived, never deleted. Archiving sets `status = ARCHIVED` and
`archivedAt`, hides it from Today, and leaves every Check-in intact.

**v1 exposes no delete route.** Deleting a definition would take its history with
it, and that is the one irreversible mistake available in this feature. A user
who wants a Habit gone archives it; a user who wants the data gone uses the
existing export and backup tooling.

## Consistency

Consistency is computed per Habit over a seven-local-day review interval as
`done Check-ins ÷ target`.

### Review Intervals and Common Geometry

Dayflow evaluates consistency across three named review interval forms that share
a common rolling seven-local-day geometry:

- **Review Period**: the seven local calendar days ending today (`today - 6 .. today`),
  used for period-bound Review evidence in the active workspace.
- **Review Window**: a read-only seven-local-day interval ending on a chosen past day
  (`ending - 6 .. ending`), whether or not a Review was saved for those boundaries.
- **Past Review Period**: the exact seven-local-day window of a Review saved before
  the current Review Period, identified by its stored boundaries.

Each form evaluates an interval `[asOf - 6 .. asOf]`, where `asOf` is today for
the current Review Period, the chosen ending day for a historical Review Window,
and the last included local day immediately before its exclusive stored `periodEnd`
boundary for a saved Past Review Period. In production, every summary caller
evaluates the interval as of its final day. Because all evaluated dates have
already elapsed, future days never enter production review evaluations.

### Habit Target Capacity and Effective Target

Consistency evaluation is bounded by **Habit Target Capacity**: the count of
in-scope days in the seven-day review interval, defined as the union of local
calendar days inside the Habit Lifetime (from its local creation day through its
local archival day, inclusive; or through the evaluated day while `ACTIVE`) and
any out-of-lifetime days carrying explicit Check-in Evidence.

The effective target depends on cadence:

- A **`DAILY`** Habit's target is the count of in-scope days within the interval
  (its Habit Target Capacity). For a Habit active throughout the seven-day
  interval, the target is 7. For a Habit created two days ago, three days are in
  scope (`today - 2`, `today - 1`, `today`), so the target is 3.
- A **`TIMES_PER_WEEK`** Habit's effective target is
  `min(targetPerWeek, targetCapacity)`. A long-lived Habit active across the full
  interval retains its weekly target (e.g. `min(5, 7) = 5`). If the Habit was
  created two days ago, its target capacity is 3, yielding an effective target of
  `min(5, 3) = 3`. This scaling reflects actual available lifetime capacity,
  ensuring a Habit is never expected to satisfy an obligation on days it did not
  exist, absent explicit Check-in Evidence.

### Explicit Facts Guarantee Non-Zero Target

Any day carrying an explicit Check-in row—whether `done: true` or `done: false`,
and including days prior to the local creation day or following the local
archival day—adds that unique local calendar day to Habit Target Capacity. Only
`done: true` increments `doneCount` (completion). Consequently, an interval
containing any explicit Check-in Evidence always has a target capacity of at
least 1, preventing the effective target from collapsing to 0 when evidence
exists.

### Zero-Capacity Invariant

Production summary selection only emits a Habit for an evaluation interval when
Habit Lifetime overlap or explicit Check-in Evidence yields a Habit Target
Capacity of at least 1 (`targetCapacity >= 1`). If a Habit neither existed during
the interval nor has any Check-in recorded within it, its capacity is 0 and it is
omitted entirely from the summary rather than rendered with zero capacity.
Consequently, a displayed consistency of `0/0` is not a valid production state.

### Historical Service Retrieval Invariant

To evaluate consistency accurately across historical Review Windows and saved
Past Review Periods, the retrieval service must select all Habit definitions
whose Habit Lifetime overlaps the evaluated seven-day interval OR which carry
any Check-in Evidence dated within that interval.

*Implementation Invariant*: This is a required implementation and acceptance
invariant. The current production query in `readHabitsActiveDuring` filters
purely by lifecycle (`createdAt < period.end` and `archivedAt >= period.start`),
which omits Habits created after `period.end` that carry valid pre-creation
Check-in Evidence within the window. Resolving this query gap is an explicit code
defect fix scheduled for the subsequent PR; this specification pins the invariant
without claiming current code is already compliant.

### Unclamped Done Count

`doneCount` is the honest sum of completed Check-ins (`done: true`) within the
interval. It is never clamped to the target: if a user completes 4 check-ins for
a Habit with an effective target of 3, the result is displayed honestly as `4/3`.

### Presentation of Absence vs. Misses

An unrecorded day within the Habit Lifetime lowers a daily Habit's ratio,
exactly as a recorded miss would. That is a presentation rule, not a storage
one, and the two are still held apart where it matters: every day carries one of
four states — `done`, `notDone`, `unrecorded`, `outOfScope` — and the UI must not
render `unrecorded` and `notDone` identically. Days outside the Habit Lifetime
without explicit Check-ins evaluate as `outOfScope` and do not count as misses or
reduce consistency.

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
- **Today's Check-in Record**: A primary toggle button where `aria-pressed` is boolean (`true` when done, `false` otherwise) and visible button text explicitly conveys state and absence (`"done today"`, `"not done today"`, and `"not recorded today"`). For unrecorded habits, an accessible "Mark not done" action allows recording `done: false` directly in a single request without first marking done (accessible name `"Mark not done for [habit name]"` satisfying WCAG 2.5.3 Label in Name), while the primary toggle records `done: true`; once recorded, the toggle switches between done and not done. Check-in mutations track independent busy states per habit ID, preventing concurrent actions on separate habits from locking one another out.
- **Amount & Note Editing**: Amount (integer `0–1,000,000`) and note (textarea, `rows={2}`, max 2,000 characters) fields remain disabled until the habit is recorded today. An independent "Save details" action commits changes; clearing an amount field sends `null`, and clearing a note field sends `null`, persisting the removal in storage.
- **Confirmed-Write & Read-Refresh Feedback**: A confirmed write updates local UI state immediately, but the action stays pending while `useHabitActions` awaits a trailing read-refresh (`refreshAfterConfirmedMutation`). If the trailing refresh fails, the confirmed write is preserved in the card and an announcement or retry toast is presented.
- **Cross-Midnight Protection**: `HabitsCard` and its rows require a `todayKey: string` property and key each row item by `${habit.id}:${todayKey}`. Day-scoped drafts, errors, and touched flags reset across calendar boundaries, ensuring uncommitted drafts from yesterday cannot leak into the new day's editor.

## Resolved Policy Decisions and Scope

- **v1 Scope Boundaries**: Habit reordering (`sortOrder` manipulation) and historical backfill beyond the Today card (e.g. multi-day retro-logging) remain part of the intended v1 feature scope, to be delivered incrementally.
- **Placement Decision**: Habits are acted on directly on the Today page (`HabitsCard`), where today's active commitments reside. Journal remains a dedicated destination for long-form entries, notes, materials, and reflections. The originating specification's phrase "beside the diary" is explicitly replaced by this architectural separation: Habits do not reside in Journal, nor do they require physical diary adjacency.
- **Q1 Pre-Creation & Post-Archive Evidence**: A Check-in within the permitted eight-day backfill window is explicit Evidence regardless of whether it precedes the Habit's local creation day or follows its local archival day. Both `done: true` and `done: false` rows add the unique local calendar day to Habit Target Capacity; only `done: true` increments `doneCount` (completion). Conversely, absent days outside the Habit Lifetime (local calendar days before the local creation day or after the local archival day with no Check-in row) evaluate as `outOfScope`, avoiding false misses or artificial target inflation.
- **Q2 Target Capacity vs. Elapsed Days**: The review interval is always a rolling seven local calendar days ending on the evaluated day: today for the current Review Period, or the chosen ending day for a historical Review Window. Because every production summary uses the interval's last day as its as-of day, Dayflow does not divide fixed calendar weeks mid-flight or clip future elapsed days in production. The calculation `min(targetPerWeek, targetCapacity)` scales weekly targets solely against available Habit Lifetime days and explicit Evidence days, ensuring fair targets for newly created or archived commitments absent explicit Check-in Evidence. The earlier framing of mid-week elapsed clipping was an artifact of synthetic unit test fixtures (`periodStart = today - 3`), not reachable production calendar behavior.

### Policy Acceptance Matrix

| Scenario | Given / Action | Result / Invariant |
| --- | --- | --- |
| Long-lived weekly target | `TIMES_PER_WEEK` with target 5, active across full 7-day trailing window | Effective target is `min(5, 7) = 5`. |
| Newly created habit | `TIMES_PER_WEEK` with target 5, created 2 days ago (3 lifetime days: `today - 2`, `today - 1`, `today`) | Effective target is `min(5, 3) = 3`. |
| Recently archived habit | `TIMES_PER_WEEK` with target 5, archived with 3 in-window lifetime days | Effective target is `min(5, 3) = 3`. |
| Pre-creation explicit evidence | Check-in recorded with `done: true` or `done: false` on a local day prior to local creation day within backfill window | Accepted, displayed as `done` or `notDone`; adds day to Habit Target Capacity; only `done: true` increments `doneCount`. |
| Absent pre/post lifetime days | Local calendar days prior to local creation day or after local archival day with no Check-in row | Evaluated as `outOfScope`; not counted as missed and excluded from Habit Target Capacity. |
| Post-archive explicit fact | Check-in recorded on a local day after local archival day within backfill window | Accepted, displayed; adds day to Habit Target Capacity; only `done: true` increments `doneCount`. |
| Done count exceeds target | Habit with effective target 3 has 4 completed check-ins in the window | `doneCount` is 4; displayed honestly as `4/3` without clamping. |
| Future request rejected | Check-in request with date after today (`date > today`) | Refused with status 400 and code `VALIDATION_ERROR` on field `date`. |
| Writable date window boundary | Check-in window spans today plus seven preceding local days | Exactly 8 writable local calendar dates: `today - 7` accepted; `today - 8` refused with `VALIDATION_ERROR`. |
| Zero capacity emission | Habit with no lifetime overlap and no Check-in rows in the evaluated interval | Capacity is 0; Habit is omitted from summary selection; displayed `0/0` is an invalid production state. |
| Historical service retrieval | Habit created after historical Review Window end carrying pre-creation Check-in in window | Retrieval service must select the Habit by evidence union; required implementation invariant for subsequent PR. |

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
- Check-in date boundary: exactly eight writable local calendar dates (`today`
  and the seven preceding local days) succeed; `today - 8` and dates after today
  are refused with `VALIDATION_ERROR`. The pair is the negative control; neither
  test is meaningful alone.
- An unrecorded day and an explicit `done: false` produce different read-model
  output. A test that cannot tell them apart would pass under the rejected design
  and must fail here.
- Explicit Check-ins recorded before local creation day or after local archival
  day within the backfill window are accepted, displayed, and add the unique local
  calendar day to Habit Target Capacity; only `done: true` increments `doneCount`.
- Absent days before local creation day or after local archival day evaluate as
  `outOfScope`, contributing neither to target capacity nor to missed counts.
- `TIMES_PER_WEEK` consistency scales target by `min(targetPerWeek, targetCapacity)`
  over rolling seven-local-day review intervals, and displays `doneCount > target`
  without clamping.
- `DAILY` consistency scales target by countable in-scope days.
- Zero-capacity invariant: production summary selection emits only Habits with
  capacity >= 1, preventing `0/0` from rendering.
- Historical retrieval invariant: historical Review Window queries select Habits
  with lifetime overlap OR explicit Check-in Evidence within the interval.
- Archiving a Habit preserves every Check-in and removes it from Today.
- Validation errors are returned with storage unavailable.
- Backup and restore round-trip both tables with their rows intact — the control
  for consequence 1 above, which otherwise fails silently.
