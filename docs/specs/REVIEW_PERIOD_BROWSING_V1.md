# Review Period Browsing v1

Status: Implemented
Date: August 22, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for period boundaries, Activity totals, Project
> movement, attribution, and missing evidence.
>
> **Supersedes one non-goal:** [Weekly Evidence Review v1](./WEEKLY_EVIDENCE_REVIEW_V1.md)
> listed "Review history or comparison browsing" as a non-goal. This
> specification takes up the history half of that item and leaves comparison
> deliberately out of scope.

## Purpose

Dayflow already persists everything an earlier Review Period needs, but Review
can only ever render the seven days ending today. The moment the window rolls,
a saved Review and the evidence it interprets become unreachable in the
interface even though nothing was deleted.

Review Period Browsing makes earlier Reviews readable without turning Review
into an editable archive. Looking back should be an act of reading, not a
second place to record.

## Language

One new term is added to [the domain language](../../CONTEXT.md). The existing
definition of **Review Period** is unchanged.

**Past Review Period**:
The exact seven-local-day window of a Review that was saved before the current
Review Period. It is identified by that Review's own stored boundaries and is
read-only.
_Avoid_: Review Period, calendar week, archive, snapshot

## Addressing a Past Review Period

A Past Review Period is addressed by the saved Review that defines it, never by
an offset from today.

This is the central design decision, and the alternative was rejected on
evidence rather than taste. A Review may only be saved for the current Review
Period, so its `periodEnd` is whatever day it happened to be saved. A grid of
rolling windows anchored on today resolves to `periodEnd = today + 1 - 7N`, so
it can only ever land on a saved Review whose save date sits an exact multiple
of seven days behind today. A Review saved three days ago would be
unreachable — invisible in its own history. Stored boundaries have no such
failure mode: they are absolute, already unique in the schema, and immune to
the local day rolling over.

Consequently, Review history is the set of Reviews the user deliberately saved.
Seven-day windows that were never written about are not part of it; see
Non-Goals.

## Reading a Past Review Period

A Past Review Period is derived at read time from current Evidence, using the
same aggregation the current period uses, over that Review's exact
`[periodStart, periodEnd)` interval. Nothing is snapshotted.

This has a consequence that must stay visible rather than hidden: correcting an
Activity that falls inside an earlier window changes that window's Review
Summary. The derived account always describes Evidence as it exists now. Only
the saved narrative and intention are fixed in time.

Project movement inside a Past Review Period follows Evidence Integrity v1,
evaluated against that window.

Missing Diary days remain missing, and absent evidence is never rendered as a
zero-valued record. A Past Review Period whose evidence has since been deleted
still renders its saved narrative, over an honestly empty summary.

## Read-Only Reviews

Saving remains restricted to the current Review Period. The existing write gate
that rejects any other period is deliberate and is not relaxed here.

- A Past Review Period shows its narrative and intention as read-only text,
  with no editing affordance reachable by pointer or keyboard.
- Reading a Past Review Period never creates, updates, or touches a Review, a
  Diary entry, or any Evidence record.
- The current Review Period keeps its existing editable save flow untouched,
  including when the user returns to it from history.

## Listing and Pagination

History is listed newest first by `periodStart`, excluding the current Review
Period, using the stable cursor pagination already established for Notes and
References. Totals are snapshot-consistent within a listing.

A user with no saved Reviews other than the current period sees an honest empty
history rather than a disabled control.

## Local-Day Rollover

Because every Past Review Period carries absolute stored boundaries, a local
day rolling over cannot change which days a listed period covers.

One case still needs handling: the period being read is the current one, and
the day rolls over while it is on screen. It then becomes a Past Review Period.
The interface must keep the same absolute window on screen and re-label it,
rather than silently swapping in different days, and must withdraw the save
affordance that no longer applies.

## Typed Failures

Existing `{ code, error }` response bodies remain authoritative:

- `400 VALIDATION_ERROR`
  - a malformed or duplicated listing parameter;
  - an invalid page limit, matching existing bounded-listing behavior.
- `400 INVALID_CURSOR`
  - a malformed, unsupported, or foreign-collection cursor.
- `404 REVIEW_NOT_FOUND`
  - a syntactically valid Review identifier with no matching record.
- `500 INTERNAL_ERROR`
  - an unexpected storage failure, using a generic Review message without
    database details.

The current-period write route keeps its existing `409 REVIEW_PERIOD_CHANGED`
behavior unchanged.

## Persistence and Performance

- No schema migration is required. `Review` is already uniquely keyed on
  `[periodStart, periodEnd)`, and every Evidence table is already queried by
  date range.
- Past-period reads are a separate read path. The dashboard bootstrap payload
  keeps describing today and does not grow a period mode.
- A period read is a bounded date-range query per Evidence table, matching the
  cost of the current period. History listing does not aggregate Evidence.

## Non-Goals

- Editing, backfilling, or deleting a Review for a Past Review Period.
- Comparison, deltas, or trends between periods.
- Snapshotting or freezing a past period's derived metrics.
- Calendar-week or configurable period lengths.
- Exporting, printing, or sharing a single period.
- Surfacing Past Review Periods anywhere outside the Review workspace.

### Deferred, not rejected

Browsing seven-day windows for which no Review was saved is planned as a
follow-up, addressed by an arbitrary anchor day rather than by a saved Review.
It is out of scope here because no saved Review history exists yet to show what
kind of looking back is actually wanted.

That evidence stays reachable meanwhile through Log, Projects, and the complete
CSV and JSON exports.

v1 must not foreclose it. A saved Review's window is expressible as "the seven
local days ending on the day it was saved," so anchor-day addressing is a
second entry point to the same read path, not a redesign. Summary derivation
must therefore take a resolved `[periodStart, periodEnd)` interval and know
nothing about how that interval was chosen.

## Acceptance Criteria

1. History lists every saved Review except the current Review Period, newest
   first, and is completely reachable through stable cursor pagination.
2. A Past Review Period reports the same summary values the current period
   would report for the same window and the same Evidence.
3. A Review saved any number of days ago is reachable in history, including
   save dates that are not a multiple of seven days behind today.
4. A saved Review renders read-only in history, with no editing affordance
   reachable by pointer or keyboard.
5. Reading any Past Review Period leaves every Review, Diary entry, and
   Evidence record byte-identical.
6. Editing an Activity inside an earlier window updates that window's derived
   summary while leaving its saved narrative and intention unchanged.
7. Missing Diary days in a Past Review Period stay missing and are never
   averaged as neutral values.
8. A Past Review Period whose evidence was deleted still renders its saved
   narrative over an empty summary.
9. Malformed listing parameters, invalid cursors, and unknown Review
   identifiers return typed 4xx responses.
10. A workspace whose only Review is the current period shows an honest empty
    history.
11. Returning to the current Review Period restores the editable save flow
    exactly as it behaves today.
12. A local-day rollover while the current period is on screen re-labels it as
    past and withdraws the save affordance, without changing the days shown.
13. The history control and read-only Review remain usable at phone, tablet,
    and desktop widths.

## Required Test Coverage

- Unit tests for history listing order, exclusion of the current period,
  cursor stability, and every typed rejection.
- A unit test asserting criterion 3 directly, across save dates that are and
  are not multiples of seven days behind today.
- Unit tests proving a past window's summary matches current-period
  aggregation for identical Evidence.
- Storage/API tests proving a past-period read mutates nothing.
- Browser coverage for opening history, the read-only saved Review, the empty
  history state, and returning to the current period with saving still
  available.
- Existing Review Period, rollover, and missing-evidence boundary tests remain
  green.
