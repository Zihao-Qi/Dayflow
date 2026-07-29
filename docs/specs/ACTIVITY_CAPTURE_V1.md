# Activity Capture v1

Status: Implemented
Date: July 28, 2026
Scope: Retrospective Manual Activity creation and custom category labels

## Purpose

Activity is Dayflow's canonical record that time was spent. Manual capture
already records today's evidence, but the UI cannot correct an omission from an
earlier day and limits category entry to five fixed choices.

Activity Capture v1 lets a person record a Manual Activity for any past or
current local calendar day and use a meaningful custom category without
turning categories into a separate lifecycle-heavy record type.

This specification extends
[Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md) and
[Activity Editing v1](./ACTIVITY_EDITING_V1.md). Those specifications remain
authoritative where this document does not add a more specific rule.

## Goals

- Let a person choose the local calendar date of a new Manual Activity.
- Reject future Activity evidence at the server trust boundary.
- Keep the entered `HH:mm` time on the selected local calendar day.
- Allow any non-empty, bounded category label rather than only fixed choices.
- Offer Dayflow's five defaults and labels used anywhere in Activity history as
  suggestions.
- Keep category suggestions complete, stable, deterministic, and separate from
  the persisted evidence itself.
- Preserve the complete create draft through rejected, malformed, or ambiguous
  responses.
- Leave Manual Activity editing on its original calendar day.

## Non-Goals

- Moving an existing Activity to another calendar day.
- Backdating or otherwise changing Focus-generated Activity evidence.
- Recording Activity in the future.
- A Category table, category identifiers, colors, budgets, icons, CRUD, or
  rename/delete semantics.
- Rewriting historical Activity rows when a label's spelling changes.
- Historical Log navigation or arbitrary-day dashboards.
- Bulk entry, CSV import, recurring Activity, or automatic classification.

## Canonical Terms

### Activity Date

The Activity Date is the local `YYYY-MM-DD` calendar key chosen when creating a
Manual Activity. Together with the entered local `HH:mm`, it determines the
persisted `startedAt` instant.

### Category Label

A Category Label is trimmed text persisted directly on one Activity. It has no
identifier or lifecycle independent from that evidence.

### Category Suggestion

A Category Suggestion is a convenience value offered by the capture interface.
Suggestions combine stable Dayflow defaults with distinct labels from complete
Activity history. Choosing a suggestion and typing a new label are equivalent
at persistence time.

## Invariants

1. **Activity remains canonical.** Capture creates one Activity; it does not
   create a second duration ledger or update Task actual minutes.
2. **Manual creation only.** This workflow creates `MANUAL` Activity with no
   Focus Session relationship.
3. **Local calendar honesty.** The browser supplies a strict local
   `YYYY-MM-DD`; existing callers may continue supplying a valid ISO timestamp,
   which is normalized to its local calendar day. `startTime` is strict
   `HH:mm`; the persisted timestamp keeps the normalized date and entered time
   in local time.
4. **No future evidence.** The selected date must be no later than the local
   date of the server's supplied clock. Validation is server-side even when
   the browser also constrains the picker.
5. **One supplied clock.** Default date, default time, and the future-date
   comparison derive from the same supplied `now`.
6. **Unbounded history.** Any valid past local calendar day is accepted.
7. **Category is evidence text.** A label is trimmed, non-empty, and at most
   100 characters. It remains part of the Activity row.
8. **Defaults remain stable.** Dayflow's defaults, in order, are `Deep Work`,
   `Learning`, `Admin`, `Health`, and `Rest`.
9. **Suggestions are complete.** Previously used category labels are queried
   across complete Activity history, not only the dashboard or Review window.
10. **Suggestions are deterministic.** Defaults appear first. Additional
    normalized labels are deduplicated case-insensitively and sorted
    case-insensitively, with exact text as the tie-breaker. A default wins a
    case-insensitive collision.
11. **Suggestions do not rewrite evidence.** Normalizing or deduplicating the
    suggestion list never changes a persisted Activity category.
12. **Free entry remains available.** A person may enter a valid label not
    currently suggested.
13. **Relationships stay consistent.** Task and direct Project attribution
    follow Evidence Integrity v1, including conflict rejection.
14. **Idempotent retry.** The mutation receipt hash includes the selected date,
    time, category, and other create fields. Retrying one logical payload
    creates at most one Activity.
15. **Validated success.** The browser closes only after a canonical response
    matches the selected local date, time, category, relationships, note, and
    duration.
16. **Draft retention.** A rejected, malformed, or mismatched response leaves
    date, time, category, note, Task, Project, and duration intact.
17. **Editing remains date-stable.** Activity Editing v1 continues to replace
    editable fields on the original local date and never accepts a replacement
    date.

## Deep Modules and Interfaces

The existing mutation parser remains the capture trust seam:

```ts
parseActivityCreateMutation(value, now?)
```

It owns strict date/time parsing, the no-future rule, bounded category and note
normalization, and relationship identifier validation. The route consumes only
the canonical result.

Category suggestion rules live behind one in-process interface:

```ts
buildActivityCategorySuggestions(persistedLabels)
```

It owns defaults, trimming, bounds, case-insensitive deduplication, and
deterministic ordering. Bootstrap supplies complete persisted labels and
returns only the built list.

## HTTP and Bootstrap Contracts

`POST /api/activities` accepts:

```json
{
  "date": "2026-07-27",
  "startTime": "09:05",
  "durationMinutes": 25,
  "category": "Writing",
  "note": "Drafted the launch note",
  "taskId": null,
  "projectId": null
}
```

`date` may be omitted for compatible callers, in which case it defaults to the
server clock's local date. A supplied future date returns
`400 VALIDATION_ERROR` with field `date`.

`GET /api/bootstrap` adds:

```json
{
  "activityCategorySuggestions": [
    "Deep Work",
    "Learning",
    "Admin",
    "Health",
    "Rest",
    "Writing"
  ]
}
```

No new Category endpoint or database table is introduced.

## User Experience

- Create mode adds a **Date** picker constrained through today's local key.
- The date defaults to today and remains in the draft until a confirmed save.
- Category becomes an editable text field with a native suggestion list.
- Default and previously used labels are suggestions, not restrictions.
- Edit mode continues to omit date movement and identifies the original
  recorded day in its context copy.
- Saving a retrospective Activity announces the selected date even when that
  record is outside the currently visible Today window.
- Invalid future dates or categories show an actionable dialog error.
- Phone layout keeps all inputs in one column with touch-sized controls.

## Acceptance Criteria

1. A Manual Activity can be created for today.
2. A Manual Activity can be created for an earlier local date and exact local
   time.
3. A future local date is rejected by both parser and route.
4. A custom category is persisted exactly after trimming.
5. Defaults and complete historical custom labels appear as suggestions.
6. Suggestion order and case-insensitive deduplication are deterministic.
7. A custom label outside the suggestion list can still be entered.
8. A Task-linked retrospective Activity receives correct historical Project
   attribution.
9. Retrying the same create payload does not duplicate the Activity.
10. The UI validates the returned Activity's selected date and category.
11. Failed, malformed, and mismatched responses retain the full create draft.
12. Edit mode cannot change the Activity calendar day.
13. Review and Project totals include the record when its date is in their
    existing calculation periods.
14. The create dialog remains usable without horizontal overflow on phone.

## Required Test Coverage

- Unit tests through `parseActivityCreateMutation` for today, past, future,
  impossible dates, local time, custom labels, defaults, and one supplied
  clock.
- Unit tests through `buildActivityCategorySuggestions` for defaults, complete
  custom labels, trimming, bounds, case-insensitive deduplication, and stable
  ordering.
- Route contract coverage for typed future-date rejection.
- Browser coverage for retrospective capture, free custom category entry,
  complete historical suggestions, relationship attribution, canonical
  response checking, draft retention, and phone usability.
- Existing Activity Editing, Focus evidence, Review, Project, reliability, and
  idempotency coverage remains green.
- The complete reliability gate.

## Release Gate

Activity Capture v1 is complete when:

- the capture parser owns and tests the no-future invariant;
- category suggestions are complete and deterministic without a Category
  entity;
- create mode accepts a past date and free category while edit mode remains
  date-stable;
- required unit, route, and browser coverage passes;
- README and project status describe the implemented workflow;
- the complete reliability gate passes.

## Implementation Record

Implemented July 28, 2026.

- `parseActivityCreateMutation` owns the past-or-today trust rule while
  retaining the existing one-clock default and local date/time normalization.
- `src/lib/activity-categories.ts` owns stable defaults, normalization,
  bounds, case-insensitive deduplication, and deterministic suggestion order.
- Bootstrap queries distinct labels across complete Activity history and
  exposes only the built suggestion list.
- The shared Activity dialog adds a constrained date picker in create mode and
  a free category field with native suggestions in both create and edit modes;
  edit mode remains fixed to the original calendar day.
- Browser success validation checks the selected local date and normalized
  category, and failed or malformed responses retain the complete draft.
- The complete `npm run check` reliability gate passed on July 28, 2026:
  124 unit tests, 13 backup/integration tests, all migration fixtures, the
  production build, and 87 Chromium browser tests.
