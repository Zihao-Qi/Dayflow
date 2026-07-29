# Journal Relationships v1

Status: Implemented
Date: July 29, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for Task and Project attribution.
>
> **Reliability contract:**
> [Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md) remains
> authoritative for idempotent creates, canonical success validation, and
> draft retention.

## Purpose

Journal capture already persists optional Task, Note, and Project
relationships, but the browser exposes only direct Project selection. Journal
Relationships v1 makes those existing relationships usable without introducing
another evidence ledger or changing what Notes and References mean.

A Note can record context for one Task. A Reference can support one Task, one
Note, both when compatible, or neither. Task linkage may provide Project
attribution. Note linkage records provenance but does not independently make a
Reference Project evidence.

## Scope

- Let a new Note link to one available Task.
- Let a new Reference link to one available Task and one loaded Note.
- Preserve direct Project selection for standalone evidence.
- Show inherited Task Project context while preventing conflicting direct
  selection.
- Validate Note compatibility when a Reference also has Task or direct Project
  attribution.
- Show Task, Note, and effective Project context on saved Journal cards.
- Keep older Notes reachable as Reference-link options through the existing
  paginated Note history.
- Validate every selected relationship in a successful response before clearing
  a draft.
- Preserve every Journal capture field after rejected, malformed, or mismatched
  responses.

## Invariants

1. **Notes remain evidence.** A Note is a deliberately captured thought,
   decision, or reminder. Linking it to a Task does not complete or otherwise
   mutate that Task.
2. **References remain evidence.** A Reference stores a URL and optional
   supporting context. Linking it to a Task or Note does not mutate either
   record.
3. **One relationship of each kind.** A Note has at most one Task and one
   direct Project. A Reference has at most one Task, one Note, and one direct
   Project.
4. **Task-derived Project attribution.** When a selected Task belongs to a
   Project, the persisted direct `projectId` is `null`; the Task's current
   Project is the effective Project.
5. **Standalone Task compatibility.** A Task without a Project may be combined
   with one direct Project.
6. **No conflicting Project attribution.** A Task-derived Project and direct
   Project must not disagree.
7. **Note provenance is distinct.** A linked Note does not by itself populate a
   Reference's `projectId` and does not independently make the Reference appear
   as Project evidence.
8. **Compatible Note context.** When a linked Note has effective Project context
   and the Reference has Task-derived or direct Project context, both Projects
   must match.
9. **Missing relationships fail honestly.** Unknown Task, Note, or Project
   identifiers produce typed `404 RELATIONSHIP_NOT_FOUND` responses.
10. **Conflict failures are typed.** Conflicting Project contexts produce
    `409 ATTRIBUTION_CONFLICT`.
11. **No silent relationship repair.** The browser may clear a direct Project
    when the person deliberately selects a Task that already owns its Project.
    It does not silently discard a selected Task or Note to resolve any other
    conflict.
12. **Available Task options.** The browser offers the union of unfinished
    palette Tasks and Tasks already present in the current bootstrap payload,
    deduplicated by identifier and ordered deterministically by title.
13. **Complete Note reachability.** Reference Note options use paginated Note
    history. The newest page loads on entry and older pages remain loadable from
    the Reference form until the complete history is reachable.
14. **Canonical Note success.** The Note draft clears only after a successful
    canonical response matches content, normalized tags, today's local date,
    selected Task, and canonical stored direct Project.
15. **Canonical Reference success.** The Reference draft clears only after a
    successful canonical response matches URL, canonical title and type, notes,
    selected Task, selected Note, and canonical stored direct Project.
16. **Complete draft retention.** Rejected, malformed, or mismatched responses
    preserve all Note fields (`content`, tags, Task, Project) and all Reference
    fields (`title`, URL, notes, Task, Note, Project).
17. **Stable retries.** Retrying an unchanged draft reuses the same mutation
    identifier. Changing any field or relationship produces a new logical
    mutation.
18. **Relationship visibility.** Journal cards show available Task and Note
    labels plus effective Project context without exposing raw identifiers.

## Browser Interaction

### Note capture

- The existing content and tags fields remain unchanged.
- `Linked task` offers the available Task option set.
- `Project` remains optional.
- Selecting a Task with a Project clears the direct Project draft, displays the
  inherited Project, and disables direct Project selection.
- Selecting no Task restores direct Project selection.
- A successful save clears the complete Note draft.

### Reference capture

- The existing title, URL, and notes fields remain unchanged.
- `Linked task` behaves like Note capture.
- `Linked note` offers the currently loaded Note history.
- The Reference form exposes `Load older notes` while more Note history exists.
- Task and Note may both be selected when their Project contexts are compatible.
- A successful save clears the complete Reference draft.

### Saved cards

- A Note card may show its linked Task and effective Project.
- A Reference card may show its linked Task, linked Note excerpt, and effective
  Project.
- If an old relationship target was deleted or is not loaded, the card remains
  usable and describes the relationship generically rather than showing an
  identifier.

## Existing Persistence and Routes

No migration is required:

- `Note.taskId` and `Note.projectId` already exist.
- `Material.taskId`, `Material.noteId`, and `Material.projectId` already exist.
- `POST /api/notes` already parses and resolves Task/Project attribution.
- `POST /api/materials` already parses and resolves Task/Note/Project
  relationships.
- relationship deletion remains `SetNull`.

The implementation deepens the existing Journal relationship module rather
than adding a parallel persistence path.

## Non-Goals

- Editing or deleting saved Notes and References.
- Linking a Note to another Note.
- More than one Task or Note relationship per record.
- Treating a linked Note as a Project-attribution snapshot.
- Historical attribution snapshots for Journal records.
- New search infrastructure for Tasks or Notes.
- Note or Reference backlinks on Task detail.
- Automatic tags, summaries, or relationship inference.
- File or PDF upload.

## Acceptance Criteria

1. A Note can be saved with a Task and inherits that Task's Project without a
   duplicate direct Project identifier.
2. A Note can combine a standalone Task with a direct Project.
3. A Reference can be saved with a Task, Note, or both.
4. Conflicting Task, Note, and direct Project contexts return typed failures and
   preserve the complete draft.
5. Missing relationship targets return typed not-found failures.
6. Older Note options remain reachable through pagination from the Reference
   form.
7. Saved cards show available Task, Note, and effective Project labels.
8. Canonical response mismatches leave every draft field and relationship
   selected.
9. A confirmed save clears every field and relationship for that capture form.
10. Direct Project-only Note and Reference capture continues to work.
11. Journal capture remains usable without horizontal overflow on a phone.

## Required Coverage

- Unit coverage for Task/Project and Note/Reference compatibility, including
  missing relationships and conflicting Projects.
- Parser coverage for Task and Note identifiers.
- Route coverage for typed relationship failures.
- Browser coverage for Task-linked Note capture, Task/Note-linked Reference
  capture, inherited Project display, complete Note-option pagination,
  canonical response checking, complete draft retention, and phone usability.
- The complete reliability, migration, backup, build, and Chromium gates remain
  mandatory.

## Implementation Record

Implemented July 29, 2026.

- Note and Reference capture use cohesive relationship-aware drafts, including
  Task-derived Project display and direct Project compatibility.
- Journal relationship resolution validates every supplied identifier before
  classifying attribution conflicts and preserves Note provenance separately
  from Reference Project attribution.
- Strict shared record decoders protect browser success handling before any
  draft is cleared.
- Journal history supplies deterministic Task options and paginated Note
  options, while saved cards show available relationship context.
- Unit, route, and browser coverage verifies canonical success, typed missing
  and conflicting relationships, no failed-write persistence, full draft
  retention, recovery announcements, complete Note reachability, and phone
  layout.
- The complete `npm run check` reliability gate passed on July 29, 2026:
  131 unit tests, 13 backup/integration tests, all migration fixtures, the
  production build, and 91 Chromium browser tests.
