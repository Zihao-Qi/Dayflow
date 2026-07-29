# Activity Editing v1

Status: Implemented
Date: July 28, 2026
Scope: Correcting manually recorded Activity evidence

## Purpose

Activity is Dayflow's canonical record of time spent. Manual capture currently
creates reliable evidence, but correcting a mistake requires deleting and
recreating the record. This specification adds a deliberate editing workflow
without weakening Focus evidence or historical Project attribution.

This specification extends
[Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md) and
[Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md). Those
specifications remain authoritative where this document does not add a more
specific rule.

## Goals

- Let a person correct a manually recorded Activity from Log.
- Preserve the Activity's local calendar day while editing its time and details.
- Keep Task and Project attribution valid and historically honest.
- Keep Focus-generated Activity evidence protected behind the Focus workflow.
- Preserve the complete edit draft through rejected or ambiguous responses.
- Refresh daily, Project, and Review calculations from the saved Activity.

## Non-Goals

- Editing Focus-generated Activity through the general Activity editor.
- Moving an Activity to another calendar day.
- Retrospective Activity creation for another day.
- Editing from every summary surface, including Today, Project detail, and the
  Focus rail.
- Adding custom categories.
- Adding Activity revision history, undo, or multi-device conflict resolution.
- Changing Activity deletion behavior.

## Canonical Terms

### Manual Activity

A Manual Activity is an Activity whose origin is `MANUAL` and which has no
source Focus Session. It may be edited through the Activity editing workflow.

### Focus Activity

A Focus Activity is generated from one completed Focus Session. Its duration,
time, and relationships remain lifecycle evidence and cannot be edited through
the Manual Activity workflow. Optional note and category enrichment continues
to use the Focus completion workflow.

## Invariants

1. **Activity remains canonical.** Editing updates the existing Activity; it
   never creates a replacement or changes totals through another ledger.
2. **Identity is stable.** The Activity identifier and creation timestamp do
   not change.
3. **Calendar day is stable.** v1 may change the wall-clock start time but keeps
   the Activity on its original local calendar day.
4. **Manual-only replacement.** An Activity is editable only when
   `origin = MANUAL` and `focusSessionId = null`.
5. **Focus evidence stays protected.** A Focus Activity returns a typed conflict
   and remains unchanged.
6. **Full replacement.** A successful edit supplies every editable field:
   start time, duration, category, note, Task relationship, and direct Project
   relationship.
7. **Historical attribution is stable by default.** When `taskId` and
   `projectId` are unchanged, the persisted `attributedProjectId` is preserved
   even if the Task later moved Projects.
8. **Relationship changes are deliberate.** When either relationship changes,
   attribution is resolved again from the selected Task and Project in the same
   transaction.
9. **No conflicting attribution.** A Task that currently belongs to a Project
   cannot be combined with another direct Project.
10. **Confirmed canonical success.** The editor closes only after a successful
    response contains the expected canonical Activity with the requested
    editable values and matching identifier.
11. **Draft ownership.** Validation errors, relationship errors, server errors,
    malformed success JSON, and mismatched success records keep every field in
    the editor.
12. **Retry safety.** Repeating the same full replacement converges on the same
    Activity state and creates no new record.

## Interface

### Replace a Manual Activity

`PUT /api/activities/:id`

Request body:

```json
{
  "startTime": "09:30",
  "durationMinutes": 45,
  "category": "Deep Work",
  "note": "Corrected what happened.",
  "taskId": "task-id-or-null",
  "projectId": "project-id-or-null"
}
```

The body is a full replacement of the editable fields:

- `startTime` is required canonical local `HH:mm`.
- `durationMinutes` is a whole number from 1 through 1440.
- `category` is required, trimmed, and bounded.
- `note` is required, trimmed, and bounded.
- `taskId` and `projectId` are required keys whose values are a valid
  identifier or `null`.
- The route derives the replacement timestamp by applying `startTime` to the
  existing Activity's local calendar day.

Successful response:

- status `200`;
- the canonical persisted Activity;
- the same `id`, `origin`, `focusSessionId`, and `createdAt`;
- an updated `updatedAt`.

Typed failures:

- `400 INVALID_JSON` or `VALIDATION_ERROR`;
- `400 VALIDATION_ERROR` for a malformed path identifier;
- `404 ACTIVITY_NOT_FOUND` or `RELATIONSHIP_NOT_FOUND`;
- `409 FOCUS_ACTIVITY_PROTECTED`;
- `409 ATTRIBUTION_CONFLICT`, `RELATIONSHIP_CONFLICT`, or `CONFLICT`;
- `500 INTERNAL_ERROR` without ORM details.

No client mutation identifier is required because `PUT` updates one stable
identity and the full replacement is naturally safe to retry.

## Persistence Workflow

In one transaction:

1. Load the Activity's identity, origin, Focus relationship, current editable
   relationships, historical attribution, and original start date.
2. Return not found when the Activity does not exist.
3. Return a protected conflict unless it is a Manual Activity.
4. Apply the requested wall-clock time to the original local date.
5. Preserve historical attribution when `taskId` and `projectId` are unchanged.
6. Otherwise resolve Task and Project attribution using the canonical evidence
   rules.
7. Replace the editable fields only while the record still satisfies the
   Manual Activity predicate.
8. Return the canonical persisted Activity.

## User Experience

- Log Stream is the canonical v1 editing entry point.
- Each Manual Activity exposes an explicit **Edit activity** control.
- Focus Activities remain readable evidence and do not expose that control.
- The existing Activity dialog supports distinct create and edit modes.
- Edit mode is prefilled from the persisted Activity and labels its action
  **Save changes**.
- The Project field remains synchronized with an inherited Task Project.
- If the original linked Task is outside the current Today options, the editor
  keeps an honest fallback option so saving another field does not silently
  unlink it.
- Saving disables the editor's mutation controls without discarding values.
- A successful edit closes the dialog and refreshes Log, Today totals, Project
  metrics, and Review evidence.
- A confirmed save followed by refresh failure is reported as saved; it is not
  presented as an unsaved mutation.

## Acceptance Criteria

1. Editing a Manual Activity's note, time, duration, category, Task, and direct
   Project updates the same record.
2. The Activity stays on its original local calendar day.
3. Daily recorded time and Review category totals reflect the edit after
   refresh.
4. Saving an Activity linked to a Task that later moved Projects preserves its
   historical attribution when relationships were not changed.
5. Deliberately changing the Task or Project recomputes attribution and rejects
   conflicts.
6. Missing Activities and relationships return typed not-found responses.
7. Focus Activities return `FOCUS_ACTIVITY_PROTECTED` and remain unchanged.
8. Malformed success JSON and a success record with another identifier keep the
   complete edit draft open.
9. A rejected write keeps the complete edit draft and can be retried without
   re-entry.
10. Repeating the same `PUT` does not create another Activity.

## Required Test Coverage

- Unit tests for strict full-replacement parsing.
- Persistence tests for identity, local-day preservation, historical
  attribution, relationship changes, missing records, Focus protection, and
  update conflicts.
- Route contract tests for malformed JSON, invalid identifiers, typed errors,
  and canonical success.
- Browser tests for prefilled editing, updated totals, Task/Project changes,
  Focus protection, malformed success, mismatched identifiers, and draft
  preservation.

## Release Gate

Activity Editing v1 is complete when:

- all invariants are enforced through the replacement interface;
- Log exposes editing only for Manual Activities;
- daily, Project, and Review calculations refresh from the persisted edit;
- the required unit, contract, and browser coverage passes;
- the complete reliability gate passes;
- project status and README documentation describe the shipped behavior.

## Implementation Record

Implemented July 28, 2026:

- `PUT /api/activities/:id` performs a transactional full replacement of the
  editable fields on one Manual Activity.
- The replacement keeps the original local calendar day, identifier, creation
  timestamp, and unchanged historical Project attribution.
- Relationship changes reuse the canonical evidence-attribution resolver.
- Focus-origin evidence returns a typed protected conflict and has no Log
  editing control.
- Log Stream exposes a prefilled edit mode with canonical response validation
  and complete draft retention across rejected or ambiguous responses.
- Unit, route-contract, and Playwright coverage exercises the required parsing,
  attribution, protection, totals, and draft-preservation behavior.
- No schema migration was required.
- The complete `npm run check` reliability gate passed on July 28, 2026.
