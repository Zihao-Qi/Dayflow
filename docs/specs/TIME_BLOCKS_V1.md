# Manual Time Blocks v1

Status: Implemented
Date: July 28, 2026

## Purpose

> **Amended by [Day Navigation v1](./DAY_NAVIGATION_V1.md), August 23, 2026.**
> This specification restricted Time Blocks to today, which made planning a
> future day impossible. The rule is widened forward: a Time Block may be
> planned for today or any later day, never for a day that has ended. Every
> other rule below still holds, and "today" should be read as "the planned
> day" throughout.

A **Time Block** is an explicit plan to reserve part of a day. It may stand on
its own or point to one unfinished **Task**, but it is never evidence that work
happened. The Log **Day Timeline** keeps planned Time Blocks separate from
recorded **Activity** and a running or completed **Focus Session**.

Manual Time Blocks v1 makes the existing Planned lane truthful: a person can
create, inspect, edit, and delete every block shown there.

## v1 Scope

- Manage Time Blocks from **Log → Timeline** for the day being viewed.
- Create a freeform Time Block with a title, start time, and end time.
- Create a Time Block linked to an unfinished Task scheduled for that day.
- Start a Task-linked draft from either the Timeline dialog or a Task's
  **Block time for _Task title_** action.
- Edit the title, start, end, and optional Task link of an existing Time Block.
- Delete an existing Time Block after explicit confirmation.
- Keep the interaction usable with keyboard, pointer, and touch at phone,
  tablet, and desktop widths.

There is one Planned lane in v1. Valid Time Blocks cannot overlap, so the lane
does not need stacking, collision columns, or hidden blocks.

## Record and Link Semantics

The existing Time Block fields remain sufficient:

- `date` is the planned local calendar day, today or later;
- `startTime` and `endTime` are local wall-clock times;
- `title` is the visible snapshot shown on the Timeline;
- `taskId` is either null or the identifier of one linked Task.

Choosing a Task prefills the title from the Task's current title and derives
the initial duration from its estimate. A positive Task estimate is used as-is;
an estimate of zero uses a 30-minute draft. A full-day estimate is bounded to
the latest representable same-day minute. The person may change the title or
times before saving. Later Task title or estimate changes do not rewrite an
existing Time Block.

Only an unfinished Task scheduled for the same day may be newly linked. Linking a
Time Block does not schedule, start, complete, reorder, or otherwise mutate the
Task. Completing a linked Task later does not delete its Time Block. If the
Task is deleted, the existing database relation becomes null and the saved
title keeps the Time Block understandable.

## Time and Overlap Invariants

- Start and end use strict minute-precision `HH:mm` values.
- End must be later than start.
- A Time Block stays within one local calendar day; cross-midnight blocks are
  invalid.
- Intervals are half-open: `[start, end)`.
- Two Time Blocks on the same day conflict when their intervals intersect.
  A block ending at `10:00` and another starting at `10:00` are valid.
- Editing excludes the edited Time Block itself from collision checks.
- Activity and Focus Session intervals never participate in Time Block
  collision checks. Planned and recorded time may intentionally overlap.
- Successful reads use deterministic start-time, end-time, creation-time, and
  identifier ordering.

Overlap is rejected rather than silently shifting, shortening, merging, or
replacing either Time Block. The dialog identifies the conflicting interval
and preserves the entire draft for correction.

## Creation

The Timeline exposes a visible **Add time block** control. It opens an
accessible **Add time block** dialog containing:

- **Title**;
- **Start**;
- **End**;
- optional **Linked task**, limited to unfinished Tasks scheduled that day;
- **Add block** and cancel controls.

Selecting a Task in the dialog applies the same title and duration prefill as
the Task quick action. A person may clear the link to keep the draft as a
freeform Time Block.

Create requests carry `X-Dayflow-Mutation-Id`. Retrying the same logical
request with the same identifier returns the original canonical Time Block and
never creates a duplicate. Reusing that identifier for a different payload is
a conflict.

## Editing and Deletion

Each rendered block is a button named:

`Time block: <title>, <start> to <end>`

Activating it opens an accessible **Edit time block** dialog with the complete
canonical record. **Save changes** validates and persists all editable fields.

Deletion requires a confirmation state with **Keep block** and
**Delete block**. **Keep block** returns safely to editing. A confirmed delete
removes only the Time Block; it never deletes or changes a linked Task,
Activity, or Focus Session.

## Reliability and Error Contract

The server is authoritative for validation, Task eligibility, overlap checks,
and canonical response data. Validation failures identify the relevant field;
missing records return not-found errors; stale relationships and overlaps
return conflicts; unexpected failures return a generic internal error.

The client clears or closes a dialog only after an expected canonical response
is confirmed. Network failures, non-success responses, malformed success JSON,
and refresh failures do not discard the current title, times, or Task
selection. Retrying a failed create reuses its mutation identifier while the
logical payload is unchanged.

After a confirmed mutation, the Timeline refreshes from persisted state. If
that refresh fails, the app reports that the mutation was saved and asks for a
reload instead of claiming the save failed.

## Accessibility and Responsive Behavior

- Dialogs expose their names and modal state to assistive technology.
- Every field has a persistent accessible label and its validation message is
  associated with it.
- Opening a dialog focuses its first useful field.
- Escape closes without saving and restores focus to the opener.
- Keyboard focus remains inside an open modal dialog.
- Confirmation focus starts on **Keep block**, making deletion deliberate.
- Saving and error state are announced without relying on color.
- At phone width, the form becomes a single column, controls retain usable
  touch targets, and neither the Timeline nor dialog introduces horizontal
  viewport overflow.

## Non-Goals

- Future-day picking or a multi-day planning interface.
- Recurring Time Blocks.
- Dragging, resizing, or dropping Tasks onto the Timeline.
- Automatic scheduling, collision resolution, or capacity suggestions.
- Multiple planned lanes or intentionally overlapping Time Blocks.
- Natural-language time parsing.
- Cross-midnight Time Blocks.
- Creating Activity or Focus Session evidence from a Time Block.
- Synchronizing an existing Time Block after its linked Task changes.

## Required Test Coverage

- Browser coverage for freeform creation, reload persistence, full editing,
  confirmed deletion, Task-driven prefill, and editable prefills.
- Half-open collision coverage, including overlap rejection with the draft
  preserved and adjacent intervals accepted.
- Evidence that Activity and Focus Session timing does not block a Time Block.
- Idempotent create replay and mutation-identifier payload conflicts.
- Malformed-success and ordinary failure coverage proving drafts remain.
- Phone-width dialog and Timeline coverage with no horizontal viewport
  overflow.
