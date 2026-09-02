# Review Window Browsing v1

Status: Implemented
Date: September 1, 2026

## Purpose

Review currently exposes the editable Review Period ending today and Past
Review Periods that have saved writing. Evidence from an earlier seven-day
interval is therefore unreachable when no Review was saved for it.

Review Window browsing lets the user choose any past local calendar day and
read the seven-day Evidence interval ending on that day. It adds a second
entry point to the existing resolved-interval read path; it does not create a
new kind of saved record.

## Domain Contract

A **Review Window** is a read-only seven-local-day interval ending on a chosen
past day, whether or not a Review was saved for those exact boundaries.

- The chosen day is inclusive.
- The resolved storage interval is `[start of ending day - 6 days, start of
  ending day + 1 day)` in local calendar time.
- Evidence is derived from current canonical records, just like the current
  Review Period and a Past Review Period.
- A matching saved Review is displayed as interpretation attached to the
  window. Its absence is shown honestly and never synthesized.
- Opening a Review Window never creates, edits, or deletes a Review or any
  Evidence.
- The current Review Period remains the only editable Review surface.

## Interface

The **Earlier reviews** panel adds a compact **Browse evidence** control:

- a native date input labelled **Review window ending**;
- a maximum value of yesterday in the user's local calendar;
- an **Open window** action;
- loading, retryable failure, and validation feedback within the panel.

Opening a Review Window:

- changes the page eyebrow to **Review window · seven days ending [date]**;
- reuses the existing evidence metrics, activity distribution, and moved
  Projects sections;
- removes every Review editing affordance;
- shows matching saved Review writing when it exists;
- otherwise shows **No review was saved for this window** and explains that
  the Evidence is still available because it is derived from current records;
- offers **Back to this week**, restoring the editable current Review exactly.

Saved Review history remains a separate list. Choosing a saved entry continues
to open its exact stored Past Review Period rather than resolving it from a
grid anchored on today.

## Read API

`GET /api/review/window?ending=YYYY-MM-DD`

The request accepts exactly one canonical local calendar date. The date must
be earlier than today. Today stays on the current bootstrap-backed Review path;
future dates cannot contain retrospective Evidence.

A successful response contains:

- `ending`: the canonical chosen local date;
- `periodStart` and `periodEnd`: exact ISO boundaries for the resolved window;
- `review`: the saved Review with exactly matching boundaries, or `null`;
- `reviewSummary`: the standard derived Review Summary;
- `projects`: Project summaries resolved for the same interval.

Malformed, duplicated, current, and future ending dates return typed 400
responses. Unexpected failures return a generic typed 500 response without
database internals.

## Reliability Rules

- The endpoint is side-effect free.
- Window selection uses latest-request-wins behavior so a slow earlier request
  cannot replace a newer choice.
- A failed window request keeps the previously visible Review content intact.
- Client code validates the complete response before displaying it.
- Local-day arithmetic, not fixed 24-hour arithmetic, defines the interval so
  daylight-saving boundaries still span exactly seven calendar days.
- The existing current Review save and rollover behavior is unchanged.

## Non-Goals

- Editing or backfilling a Review for an earlier window.
- Saving a Review Window as a new record.
- Comparing windows, showing deltas, or adding charts.
- Calendar-week semantics or configurable interval lengths.
- Exporting, printing, or sharing a Review Window.
- Replacing saved Review history with an anchor-day grid.

## Acceptance Criteria

1. A user can choose any past local date and open the seven-day Review Window
   ending on that date, even when no Review was saved.
2. The window reports the same derived summary the current Review Period would
   report for identical Evidence in the same resolved interval.
3. A saved Review with exactly matching boundaries is shown; an overlapping or
   differently bounded Review is not.
4. An unsaved window clearly says no Review was saved and exposes no writing or
   save control.
5. Returning to this week restores the editable current Review without changing
   its draft or persistence behavior.
6. Choosing a malformed, duplicated, current, or future ending date produces a
   typed rejection and writes nothing.
7. Correcting Evidence later changes the derived window summary without
   creating or rewriting Review writing.
8. A slower earlier selection cannot replace a later selected window.
9. Review Window browsing remains usable at phone, tablet, and desktop widths
   without horizontal overflow.
10. Existing saved-history, current-period, rollover, and missing-Evidence tests
    remain green.

## Required Test Coverage

- Unit tests for canonical ending-date parsing, duplicate parameters,
  past-only enforcement, and DST-safe seven-day resolution.
- Integration tests for unsaved windows, exact saved-Review matching, derived
  evidence, and byte-identical storage before and after reads.
- Browser coverage for opening an unsaved window, reading a matching saved
  Review, returning to the current editor, stale-response rejection, failure
  recovery, and phone-width layout.
