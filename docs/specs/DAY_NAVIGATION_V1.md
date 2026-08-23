# Day Navigation v1

Status: Implemented
Date: August 23, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for local-day boundaries, Activity totals, and the rule
> that absent Evidence stays absent.
>
> **Amends one rule:** [Manual Time Blocks v1](./TIME_BLOCKS_V1.md) defines a
> Time Block as "an explicit plan to reserve part of today" and requires
> `date` to be today. Planning a future day is impossible under that rule, so
> this specification widens it forward only. Nothing about past days changes.

## Purpose

Dayflow can only ever show today. A task can be given a future date, but the
day it lands on cannot be looked at, so there is no way to see whether tomorrow
is already full before adding to it.

Day Navigation makes any day readable and future days plannable, without
turning Today into a general-purpose date browser. Today keeps its job: make
today legible.

## Language

One term is added to [the domain language](../../CONTEXT.md).

**Viewed Day**:
The single local calendar day the Log destination is showing. It defaults to
today and never changes what Today shows.
_Avoid_: Today, selected date, current day

## Which Surface Moves

Log already is the day view. It is internally named `day`, owns the Stream and
Timeline presentations, and shows scheduled work, recorded Activity, and
planned Time Blocks for one day. It is hard-wired to today only by its inputs.

Log therefore gains the picker. Today does not.

This matters because the two surfaces answer different questions. Today asks
what deserves attention now, and its Focus Timer, capture affordances, and
Daily Pulse are all anchored to the present moment. A date-switching Today
would need every one of those to mean something on a day that has not happened,
which they cannot.

## What a Viewed Day Offers

A Viewed Day is one of three kinds, and the interface says which:

**Past day** — reading and correction.
- Shows scheduled Tasks, recorded Activity, and the Time Blocks that were
  planned.
- Keeps Manual Activity editing, which
  [Activity Editing v1](./ACTIVITY_EDITING_V1.md) already allows for earlier
  days.
- Offers no planning: a Time Block cannot be created for a day that has ended,
  and no new plan can be made for the past.
- Keeps an existing Time Block editable and deletable. The restriction is on
  creating a plan for a finished day, not on correcting the record of one that
  was made while it was still today.

**Today** — unchanged in every respect.

**Future day** — planning only. Log opens such a day on Timeline rather than
Stream, because Stream is built around recorded Activity that a future day
cannot have, and planning blocks is the only thing that day supports. Today and
past days keep opening on Stream.
- Shows Tasks scheduled for that day and Time Blocks planned for it.
- Supports creating, editing, and deleting Time Blocks for that day.
- Offers no Activity capture or editing. Evidence of a day that has not
  happened does not exist, and
  [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md) forbids inventing it.
- Shows planned time only. A planned-versus-recorded comparison is meaningless
  before the day begins and must not display a zero as though it were a
  measurement.

## Time Blocks on a Future Day

`assertTimeBlockIsToday` becomes `assertTimeBlockIsNotPast`: a Time Block may
be planned for today or any later day, and never for a day that has ended.

The rest of the Time Block contract is unchanged, including non-overlap within
a day, the Task-title snapshot, idempotent creation, and confirmed deletion.

Task linking follows the same widening: a Time Block on a future day may link
an unfinished Task scheduled for that same day, exactly as today's blocks link
today's Tasks. A block never links a Task scheduled for a different day.

## Reading a Viewed Day

The dashboard bootstrap payload keeps describing today. A Viewed Day other than
today is a separate read path taking a resolved local date, so the payload that
every session loads does not grow a mode.

The read returns, for that date: scheduled Tasks, Time Blocks, and — for today
or a past day only — recorded Activities.

## Bounds and Navigation

- The picker moves one day at a time and accepts a direct date.
- Backward navigation is bounded by the earliest persisted Evidence; there is
  nothing to read before it.
- Forward navigation is bounded to eight weeks.

  The bound is a product statement, not a performance limit: a single-day read
  costs the same whatever the date. Dayflow has no concept that thinks in
  months or years — Project target duration is in days or weeks, a Review
  Period is seven local days, and the loop is daily — so a longer horizon would
  imply a planner this is not.

  Scheduling a Task for a distant date stays unbounded, so this limits only how
  far Log navigates, and with it the only thing a distant day offers: placing
  an hour-by-hour Time Block. Widening the bound later is a pure relaxation;
  narrowing it would strand plans already made, so eight weeks is the
  conservative choice rather than the permissive one.
- Returning to today is always one action away and is always offered, so the
  user is never stranded on another day.
- The Viewed Day resets to today when the local day rolls over, because the day
  they were looking at is now a different kind of day.
- The Viewed Day also resets to today on leaving Log and returning. A day that
  persists across a detour through Projects or Journal invites acting on the
  wrong day without noticing, and the cost of resetting is one navigation.

## Typed Failures

Existing `{ code, error, field }` bodies remain authoritative:

- `400 VALIDATION_ERROR`
  - a missing, malformed, duplicated, or non-canonical date parameter;
  - a date outside the supported bounds;
  - an Activity mutation addressed to a future day, which the existing
    "Activity date cannot be in the future." rule already covers;
  - a Time Block addressed to a past day.
- `500 INTERNAL_ERROR`
  - an unexpected storage failure, without database details.

## Non-Goals

- A date picker on Today, or any change to what Today shows.
- Recording Activity, running a Focus Session, or writing Diary content for a
  day other than today.
- Multi-day, week, or month views. This is one day at a time.
- Drag-resizing, automatic placement, or capacity-aware suggestions, which
  Manual Time Blocks v1 already defers.
- Moving a Task by dragging it between days.

## Acceptance Criteria

1. Log opens on today, and Today is unaffected by any Viewed Day change.
2. A past Viewed Day shows its scheduled Tasks, recorded Activity, and planned
   Time Blocks, and offers no way to create a Time Block.
3. Manual Activity editing keeps working on a past Viewed Day.
4. A future Viewed Day shows scheduled Tasks and Time Blocks, and offers no
   Activity capture or editing.
5. A future Viewed Day shows planned time without presenting absent recorded
   time as a zero measurement.
6. A Time Block can be created, edited, and deleted for a future day, and
   non-overlap is enforced within that day.
7. A Time Block addressed to a past day is rejected with a typed 400.
8. An Activity addressed to a future day is rejected with a typed 400.
9. A Time Block on a future day may link only an unfinished Task scheduled for
   that same day.
10. Malformed, duplicated, and out-of-bounds date parameters return typed 400s.
11. Backward navigation stops at the earliest persisted Evidence; forward
    navigation stops eight weeks ahead, and a date beyond it is rejected
    rather than clamped.
12. Returning to today is always available and restores today's full behavior.
13. A local-day rollover while another day is viewed returns the user to today
    rather than silently changing what that day means.
14. Reading any Viewed Day mutates no stored record.
15. The picker and both Log presentations remain usable at phone, tablet, and
    desktop widths.

## Required Test Coverage

- Unit tests for date-parameter parsing, bounds, and every typed rejection.
- Unit tests for the widened Time Block date rule, covering today, a future
  day, and a past day.
- Unit tests proving a future day's read excludes Activity entirely.
- Storage tests proving a Viewed Day read mutates nothing, and that Time Block
  non-overlap holds independently on each day.
- Browser coverage for moving between days, the three day kinds and their
  differing affordances, planning a Time Block on a future day, returning to
  today, and phone-width layout.
- Existing Today, Log, Time Block, and Activity gates remain green.
