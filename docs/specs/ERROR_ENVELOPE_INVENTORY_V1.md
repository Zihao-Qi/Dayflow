# Error Envelope Inventory v1

Status: Implemented
Date: September 4, 2026
Scope: Phase 0 characterization of `src/app/api/**`

## Purpose

This inventory freezes Dayflow's reachable non-2xx HTTP JSON contracts before
the modular-monolith migration moves their implementations. A row represents a
response branch at an HTTP boundary. Where one branch forwards a typed error,
the rows split the reachable status/code variants (not every validation message
produced by the same parser). The exact example named in each row is the
contract pinned by the cited test. Key order is not part of the contract.

`Keys` explicitly records whether `code` and `field` are present. “Existing”
means a test already pinned the full status and parsed body before Phase 0;
“New” means this characterization added that pin.
Within a table, “same test” means the exact file and test name in the nearest
preceding fully qualified Contract test cell.

## Bootstrap, reads, and exports

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/bootstrap` | Prisma `P2021` or `P2022` (database migration required) | 503 | `{"code":"DATABASE_MIGRATION_REQUIRED","error":"Dayflow's local database needs an update. Stop Dayflow, run \`npm run db:migrate\`, then start Dayflow again."}` | `code`; no `field` | `tests/integration/bootstrap-startup-errors.test.ts` — “bootstrap tells the user how to update an outdated database” | Existing |
| `GET /api/bootstrap` | Any other failure | 500 | `{"code":"INTERNAL_ERROR","error":"Dayflow could not open its local data. Try again."}` | `code`; no `field` | same test | New |
| `GET /api/day` | Invalid or out-of-range `date`; example `2026-02-30` | 400 | `{"error":"That day is not a real calendar date.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/day-route-contracts.test.ts` — “Day route pins its validation envelope” | New |
| `GET /api/day` | Any other failure | 500 | `{"error":"That day could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/day-route-contracts.test.ts` — “Day route pins its internal envelope” | New |
| `GET /api/exports/:kind` | Unsupported kind | 404 | `{"error":"CSV export not found.","code":"EXPORT_NOT_FOUND"}` | `code`; no `field` | `tests/unit/csv-export-route-contracts.test.ts` — “CSV export route rejects unsupported kinds without attachment headers” | Existing |
| `GET /api/exports/:kind` | Export failure | 500 | `{"error":"CSV export could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/csv-export-route-contracts.test.ts` — “CSV export route pins its internal error envelope” | New |

`GET /api/agent-export` has no non-2xx JSON branch. Its success-payload keys
and read invariants are pinned by `tests/integration/read-model-invariants.test.ts`.

## Backup boundaries

The shared mapper rows below apply to every named backup route that can throw
the stated error. Route-specific validation rows follow them.

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/backups`, `PUT /api/backups/automatic`, `POST`/`DELETE /api/backups/restore` | Missing `X-Dayflow-Local-Action: 1` | 403 | `{"error":"This local data action requires an explicit Dayflow request.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup guards pin exact forbidden and unsupported-media envelopes” | New |
| Same mutation routes | Content type is not `application/json` | 415 | `{"error":"Use application/json for local data actions.","code":"UNSUPPORTED_MEDIA_TYPE"}` | `code`; no `field` | same test | New |
| Same mutation routes | `Origin` differs from request origin | 403 | `{"error":"Cross-origin local data actions are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | same test | New |
| All backup reads and mutations | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | same test | New |
| All backup routes | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| All backup routes | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | same test | New |
| All backup routes | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| Restore or download | Corrupt/incompatible managed backup | 422 | `{"error":"The selected backup is corrupt or incompatible and cannot be restored.","code":"CORRUPT_BACKUP","field":"backupId"}` | `code`, `field` | same test | New |
| `POST /api/backups/restore` | Restore disabled in this process | 503 | `{"error":"Restore scheduling is disabled in this Dayflow process.","code":"RESTORE_DISABLED"}` | `code`; no `field` | same test | New |
| `GET /api/backups` | Unexpected list failure | 500 | `{"error":"Backup list could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `POST /api/backups` | Unexpected creation failure | 500 | `{"error":"Backup creation could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `GET`/`PUT /api/backups/automatic` | Unexpected automatic-settings failure | 500 | `{"error":"Automatic backup settings could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `GET /api/backups/:id/download` | Unexpected download failure | 500 | `{"error":"Backup download could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `POST /api/backups/restore` | Unexpected scheduling failure | 500 | `{"error":"Restore scheduling could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `DELETE /api/backups/restore` | Unexpected cancellation failure | 500 | `{"error":"Restore cancellation could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup error mapping pins management statuses, optional fields, and fallback” | New |
| `POST /api/backups` | Malformed JSON | 400 | `{"error":"The request body must be valid JSON.","code":"INVALID_JSON"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `POST /api/backups` | Body is not an object | 400 | `{"error":"The request body must be a JSON object.","code":"VALIDATION_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/backups` | Body contains any field | 400 | `{"error":"Backup creation does not accept a destination path.","code":"VALIDATION_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/backups/restore` | Unexpected field `unexpected` | 400 | `{"error":"Unexpected restore field: unexpected.","code":"VALIDATION_ERROR","field":"unexpected"}` | `code`, `field` | same test | New |
| `POST /api/backups/restore` | `backupId` is absent/not text | 400 | `{"error":"Choose a managed backup.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | same test | New |
| `POST /api/backups/restore` | `expectedPayloadSha256` is absent/not text | 400 | `{"error":"The selected backup checksum is required.","code":"VALIDATION_ERROR","field":"expectedPayloadSha256"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “restore staging requires exact confirmation before filesystem access” (same validation helper) | Existing |
| `POST /api/backups/restore` | `confirmation` is absent/not text or is not exactly `RESTORE` | 400 | `{"error":"Type RESTORE exactly to schedule replacement.","code":"VALIDATION_ERROR","field":"confirmation"}` | `code`, `field` | same test | Existing |
| `DELETE /api/backups/restore` | Body contains any field | 400 | `{"error":"Canceling a restore does not accept any fields.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `PUT /api/backups/automatic` | Invalid policy; zero `intervalHours` example | 400 | `{"error":"The backup interval in hours must be a whole number between 1 and 168.","code":"VALIDATION_ERROR","field":"intervalHours"}` | `code`, `field` | `tests/unit/automatic-backup-route-contracts.test.ts` — “automatic backup policy errors preserve their exact envelope” | New |

## Tasks, Time Blocks, and queue workflows

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/tasks` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task routes validate mutation and path identifiers before writing” | Existing |
| `POST /api/tasks` | Receipt id reused for a different request | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/integration/focus-session-idempotency.test.ts` — “reusing an identifier for a different Focus start payload is rejected” (shared receipt contract) | Existing |
| `POST /api/tasks` | Stored receipt JSON cannot be decoded | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” (shared mapper contract) | New |
| `POST /api/tasks` | Invalid create body; negative estimate example | 400 | `{"error":"Estimate must be a whole number from 0 to 1440 minutes.","code":"VALIDATION_ERROR","field":"estimateMinutes"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch expose typed validation fields” | Existing |
| `POST /api/tasks` | Phase supplied without Project | 400 | `{"error":"A task cannot have a phase without a project.","code":"VALIDATION_ERROR","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `POST /api/tasks`, `PATCH /api/tasks/:id` | Selected Project missing | 404 | `{"error":"The selected project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `POST /api/tasks`, `PATCH /api/tasks/:id` | Selected Phase missing | 404 | `{"error":"The selected phase could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `POST`/`PATCH /api/tasks/:id` | Completed Project or mismatched Phase | 409 | `{"error":"The selected phase does not belong to this project.","code":"RELATIONSHIP_CONFLICT","field":"phaseId"}` | `code`, `field` | `tests/integration/transactional-workflows.test.ts` — “task update rejects an incompatible placement and rolls back” | New |
| `POST /api/tasks` | Prisma `P2003` | 409 | `{"error":"The selected task relationship is no longer available.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `POST /api/tasks` | Unexpected failure | 500 | `{"error":"Task could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `PATCH /api/tasks/:id` | Malformed/invalid input | 400 | `{"error":"Task status is invalid.","code":"VALIDATION_ERROR","field":"status"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch expose typed validation fields” | Existing |
| `PATCH /api/tasks/:id` | Pre-read misses Task, or Prisma `P2025` race | 404 | `{"error":"Task not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/integration/transactional-workflows.test.ts` — “task update translates a P2025 not-found race and restores the row” | New |
| `PATCH /api/tasks/:id` | Prisma `P2003` | 409 | `{"error":"A related record changed before the task could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `PATCH /api/tasks/:id` | Unexpected failure | 500 | `{"error":"Task could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `DELETE /api/tasks/:id` | Invalid id | 400 | `{"error":"Task identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task routes validate mutation and path identifiers before writing” | Existing |
| `DELETE /api/tasks/:id` | Prisma `P2025` | 404 | `{"error":"Task not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `DELETE /api/tasks/:id` | Prisma `P2003` | 409 | `{"error":"A related record changed before the task could be saved.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| `DELETE /api/tasks/:id` | Unexpected failure | 500 | `{"error":"Task could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/tasks/reorder` | Invalid ids | 400 | `{"error":"Task identifiers must not contain duplicates.","code":"VALIDATION_ERROR","field":"ids"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `POST /api/tasks/reorder` | Any requested Task missing | 404 | `{"error":"One or more tasks could not be found.","code":"NOT_FOUND","field":"ids"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/reorder` | Prisma `P2025` | 409 | `{"error":"A task changed before its order could be saved.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| `POST /api/tasks/reorder` | Unexpected failure | 500 | `{"error":"Task order could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/tasks/:id/schedule/undo` | Invalid id | 400 | `{"error":"Task identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “path-based workflow routes reject invalid identifiers before querying” | Existing |
| Same | Task missing | 404 | `{"error":"Task not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| Same | No schedule change remains | 404 | `{"error":"There is no schedule change to undo.","code":"NOT_FOUND","field":"scheduleChange"}` | `code`, `field` | same test | New |
| Same | Claim conflict, Prisma `P2003`, or Prisma `P2025` | 409 | `{"error":"The schedule changed before it could be undone.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| Same | Unexpected failure | 500 | `{"error":"The schedule change could not be undone.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/time-blocks` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create validates mutation identifiers before writing” | Existing |
| Same | Receipt payload mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| Same | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | same test | New |
| `POST`/`PUT /api/time-blocks[/\:id]` | Invalid draft; bad date example | 400 | `{"error":"Time Block date must be a valid local date in YYYY-MM-DD format.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create exposes typed field validation” | Existing |
| Same | Selected Task missing, including Prisma `P2003` | 404 | `{"error":"The selected Task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| Same | Task/day relationship conflict | 409 | `{"error":"Choose an unfinished Task scheduled for the same day as the Time Block.","code":"RELATIONSHIP_CONFLICT","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| Same | Overlap | 409 | `{"error":"This Time Block overlaps \"Planning\" at 09:00–10:00.","code":"TIME_BLOCK_OVERLAP","field":"startTime"}` | `code`, `field` | same test | New |
| `PUT`/`DELETE /api/time-blocks/:id` | Missing row or Prisma `P2025` | 404 | `{"error":"Time Block not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | same test | New |
| `POST /api/time-blocks` | Unexpected failure | 500 | `{"error":"Time Block could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `PUT /api/time-blocks/:id` | Unexpected failure | 500 | `{"error":"Time Block could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `DELETE /api/time-blocks/:id` | Unexpected failure | 500 | `{"error":"Time Block could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `POST`/`PATCH`/`DELETE /api/focus-queue` | Malformed or invalid body; bad placement example | 400 | `{"error":"Queue placement must be next or end.","code":"VALIDATION_ERROR","field":"placement"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `POST`/`PATCH`/`DELETE /api/focus-queue` | Defensive `FocusQueueError`; bad placement example | 400 | `{"error":"Queue placement must be next or end.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `POST /api/focus-queue` | Task missing | 404 | `{"error":"Task not found.","code":"NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `POST /api/focus-queue` | Task already completed | 409 | `{"error":"Completed tasks cannot be queued.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| `PATCH /api/focus-queue` | Expected queue order is stale | 409 | `{"error":"Queue order is out of date. Refresh and try again.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `POST`/`PATCH`/`DELETE /api/focus-queue` | Unexpected failure | 500 | `{"error":"Focus queue could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |

## Projects and Phases

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/projects/:id` | Project missing | 404 | `{"error":"Project not found."}` | no `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project detail keeps its legacy code-less not-found envelope” | New |
| `POST /api/projects` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase creates validate mutation identifiers before writing” | Existing |
| Same | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/integration/focus-session-idempotency.test.ts` — “reusing an identifier for a different Focus start payload is rejected” | Existing |
| Same | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| Same | Invalid body; negative weekly budget example | 400 | `{"error":"Weekly effort budget must be a whole number from 1 to 10080 minutes.","code":"VALIDATION_ERROR","field":"weeklyMinutesBudget"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes expose typed validation fields” | Existing |
| Same | Prisma `P2003` | 409 | `{"error":"A related record changed before the Project could be created.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Project could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `PATCH /api/projects/:id` | Invalid body or id | 400 | `{"error":"Project identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| Same | Project absent or Prisma `P2025` | 404 | `{"error":"Project not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Unfinished Tasks and no completion confirmation | 409 | `{"error":"Confirm completion while unfinished tasks remain.","code":"CONFLICT","field":"status","requiresConfirmation":true}` | `code`, `field`, plus `requiresConfirmation` | `tests/integration/transactional-workflows.test.ts` — “Project completion with unfinished Tasks requires confirmation and changes nothing” | New |
| Same | Prisma `P2003` | 409 | `{"error":"A related record changed before the Project could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Unexpected failure | 500 | `{"error":"Project could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `DELETE /api/projects/:id` | Missing `confirm=true` | 400 | `{"error":"Project deletion requires confirmation.","code":"VALIDATION_ERROR","field":"confirm"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project deletion requires a typed confirmation response” | Existing |
| Same | Project absent or Prisma `P2025` | 404 | `{"error":"Project not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Prisma `P2003` | 409 | `{"error":"A related record changed before the Project could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Unexpected failure | 500 | `{"error":"Project could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `POST /api/projects/:id/phases` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase creates validate mutation identifiers before writing” | Existing |
| Same | Parent Project absent | 404 | `{"error":"The selected project could not be found.","code":"NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| Same | Parent Project completed | 409 | `{"error":"Reopen the completed project before adding unfinished work.","code":"RELATIONSHIP_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| Same | Prisma `P2003` | 409 | `{"error":"The selected Project is no longer available.","code":"CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Phase could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `PATCH /api/phases/:id` | Invalid body/id | 400 | `{"error":"Phase order must be a whole number from 0 to 2147483647.","code":"VALIDATION_ERROR","field":"sortOrder"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes expose typed validation fields” | Existing |
| Same | Prisma `P2025` | 404 | `{"error":"Phase not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Unexpected failure | 500 | `{"error":"Phase could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `DELETE /api/phases/:id` | Invalid id | 400 | `{"error":"Phase identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| Same | Prisma `P2025` | 404 | `{"error":"Phase not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| Same | Unexpected failure | 500 | `{"error":"Phase could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |

## Focus and Activity

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/focus-session` | Snapshot load failure | 500 | `{"error":"Focus timer could not be loaded.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus snapshot GET pins its internal envelope” | New |
| `POST /api/focus-session` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” (shared idempotency mapper) | New |
| Same | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/integration/focus-session-idempotency.test.ts` — “reusing an identifier for a different Focus start payload is rejected” | Existing |
| Same | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| Same | Invalid body; nonnumeric duration example | 400 | `{"error":"Timer duration must be between 1 and 240 minutes.","code":"VALIDATION_ERROR","field":"plannedMinutes"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| Same | Selected Task missing | 404 | `{"error":"The selected task could not be found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| Same | Selected Project missing | 404 | `{"error":"The selected project could not be found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| Same | Existing active session or Prisma `P2002` active-key conflict | 409 | `{"error":"Finish or cancel the active timer first.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes”; `tests/integration/focus-session-idempotency.test.ts` — “different simultaneous starts resolve as one created session and conflicts for every other request” | New |
| Same | Task belongs to different Project | 409 | `{"error":"The selected task belongs to a different project.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| Same | Prisma `P2003` | 409 | `{"error":"A selected Focus relationship changed before the timer started.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Focus timer could not be started.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `PATCH /api/focus-session/:id` | Invalid input/id | 400 | `{"error":"Unknown timer action.","code":"VALIDATION_ERROR","field":"action"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| Same | Session missing | 404 | `{"error":"Focus session not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus transition pins not-found, conflict, Prisma, and fallback envelopes” | New |
| Same | State transition conflict | 409 | `{"error":"Only a running timer can be paused.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| Same | Prisma `P2003` or `P2025` | 409 | `{"error":"The Focus session changed before it could be saved.","code":"CONFLICT"}` | `code`; no `field` | same test | New |
| Same | Unexpected failure | 500 | `{"error":"Focus timer could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | same test | New |
| `POST /api/activities` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | same test | New |
| Same | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | same test | New |
| Same | Invalid JSON/body | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| Same | Linked Task missing | 404 | `{"error":"The linked task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Linked Project missing | 404 | `{"error":"The linked project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Attribution conflict | 409 | `{"error":"The selected task belongs to a different project.","code":"ATTRIBUTION_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Prisma `P2003` or `P2025` | 409 | `{"error":"The linked Activity relationship is no longer available.","code":"RELATIONSHIP_CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Unexpected failure | 500 | `{"error":"Activity could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Invalid input/id | 400 | `{"error":"Activity identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity replacement route validates the path and full body before writing” | Existing |
| Same | Activity missing | 404 | `{"error":"Activity not found.","code":"ACTIVITY_NOT_FOUND"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Focus-origin Activity | 409 | `{"error":"Focus evidence cannot be edited here.","code":"FOCUS_ACTIVITY_PROTECTED"}` | `code`; no `field` | `tests/integration/transactional-workflows.test.ts` — “Activity replace and delete protect Focus-origin evidence” | New |
| Same | Stale `updatedAt` | 409 | `{"error":"The Activity changed before it could be updated.","code":"CONFLICT"}` | `code`; no `field` | `tests/integration/transactional-workflows.test.ts` — “Activity replacement detects stale updatedAt and rolls back the competing write” | New |
| Same | Linked Task missing | 404 | `{"error":"The linked task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Linked Project missing | 404 | `{"error":"The linked project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Attribution mismatch | 409 | `{"error":"The selected task belongs to a different project.","code":"ATTRIBUTION_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Prisma `P2003` or `P2025` | 409 | `{"error":"The linked Activity relationship is no longer available.","code":"RELATIONSHIP_CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| Same | Unexpected failure | 500 | `{"error":"Activity could not be updated.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `DELETE /api/activities/:id` | Invalid id | 400 | `{"error":"Activity identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “path-based workflow routes reject invalid identifiers before querying” | Existing |
| Same | Activity missing | 404 | `{"error":"Activity not found."}` | no `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| Same | Focus-origin Activity | 409 | `{"error":"Focus evidence cannot be deleted."}` | no `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes”; `tests/integration/transactional-workflows.test.ts` — “Activity replace and delete protect Focus-origin evidence” | New |
| Same | Optimistic delete conflict, Prisma `P2003`, or Prisma `P2025` | 409 | `{"error":"The Activity changed before it could be deleted.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Activity could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| `PUT /api/diary` | Invalid input | 400 | `{"error":"Diary date must be a valid calendar date.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| Same | Unexpected failure | 500 | `{"error":"Diary could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Diary route pins its internal envelope” | New |

## Journal and Review

Journal routes intentionally use `{code, error}` and never emit `field`, even
when a relationship or validation condition is field-specific.

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/notes` | Invalid cursor | 400 | `{"code":"INVALID_CURSOR","error":"The pagination cursor is invalid."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| Same | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"Notes could not be loaded."}` | `code`; no `field` | same test | New |
| `POST /api/notes` | Malformed JSON | 400 | `{"code":"INVALID_JSON","error":"Request body must be valid JSON."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| Same | Invalid input | 400 | `{"code":"VALIDATION_ERROR","error":"Write something before saving this note."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| Same | Invalid mutation id | 400 | `{"code":"INVALID_MUTATION_ID","error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Note and Material routes validate mutation identifiers before writing” | Existing |
| Same | Receipt mismatch | 409 | `{"code":"MUTATION_ID_CONFLICT","error":"This mutation identifier was already used for a different request."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Invalid stored receipt | 500 | `{"code":"INVALID_MUTATION_RECEIPT","error":"The saved mutation receipt could not be read."}` | `code`; no `field` | same test | New |
| Same | Linked Task missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked task could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Linked Project missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked project could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Attribution conflict | 409 | `{"code":"ATTRIBUTION_CONFLICT","error":"The selected task belongs to a different project."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"The note could not be saved."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `GET /api/materials` | Unsupported tag filter | 400 | `{"code":"VALIDATION_ERROR","error":"Tag filtering is available only for Notes."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| Same | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"References could not be loaded."}` | `code`; no `field` | same test | New |
| `POST /api/materials` | Malformed JSON | 400 | `{"code":"INVALID_JSON","error":"Request body must be valid JSON."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| Same | Invalid input; missing URL example | 400 | `{"code":"VALIDATION_ERROR","error":"Add a URL before saving this reference."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| Same | Invalid mutation id | 400 | `{"code":"INVALID_MUTATION_ID","error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Note and Material routes validate mutation identifiers before writing” | Existing |
| Same | Receipt mismatch | 409 | `{"code":"MUTATION_ID_CONFLICT","error":"This mutation identifier was already used for a different request."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Invalid stored receipt | 500 | `{"code":"INVALID_MUTATION_RECEIPT","error":"The saved mutation receipt could not be read."}` | `code`; no `field` | same test | New |
| Same | Linked Task missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked task could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Linked Project missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked project could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Linked Note missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked note could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| Same | Attribution conflict | 409 | `{"code":"ATTRIBUTION_CONFLICT","error":"The selected note belongs to a different project."}` | `code`; no `field` | `tests/unit/journal-relations.test.ts` — “Material relationships reject Project attribution that conflicts with the linked Note” | Existing |
| Same | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"The reference could not be saved."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `PUT /api/review` | Invalid body | 400 | `{"error":"Write a narrative or next-period intention before saving this Review.","code":"VALIDATION_ERROR","field":"review"}` | `code`, `field` | `tests/unit/review-route-contracts.test.ts` — “Review route returns typed malformed and empty mutation errors” | Existing |
| Same | Review period changed | 409 | `{"error":"The Review Period changed. Refresh and try again.","code":"REVIEW_PERIOD_CHANGED","field":"reviewPeriod"}` | `code`, `field` | `tests/unit/review-route-contracts.test.ts` — “Review route rejects a stale exact period before persistence” | Existing |
| Same | Unexpected failure | 500 | `{"error":"Review could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/:id` | Invalid id | 400 | `{"error":"That Review identifier is not valid.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| Same | Review missing | 404 | `{"error":"That Review no longer exists.","code":"REVIEW_NOT_FOUND"}` | `code`; no `field` | same test | New |
| Same | Unexpected failure | 500 | `{"error":"Review period could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/history` | Invalid query/cursor | 400 | `{"error":"That pagination cursor is no longer usable. Reload Review history.","code":"INVALID_CURSOR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Review history could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/window` | Missing/invalid ending day | 400 | `{"error":"Choose a Review Window ending day.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| Same | Unexpected failure | 500 | `{"error":"Review Window could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |

## Findings

- `GET /api/agent-export` is a complete-data export and currently returns a
  directly planted future-dated Activity, while bootstrap and day reads filter
  future evidence. Phase 0 pins that current behavior in
  `tests/integration/read-model-invariants.test.ts`; production behavior was
  not changed.
- `GET /api/projects/:id` and two `DELETE /api/activities/:id` branches omit
  both `code` and `field`. This is intentional characterization, not a
  normalization.
- Journal routes preserve their historical `{code, error}` shape and never
  include `field`; other JSON boundaries generally use `{error, code}`.
- Prisma `P2003` is not translated consistently: Time Blocks return 404
  `RELATIONSHIP_NOT_FOUND`; Task, Project, Focus, and Activity routes return
  409 conflicts. Prisma `P2025` likewise means 404 for Task/Project/Phase/Time
  Block item writes but 409 for Focus transitions, Activity deletes, Task
  reorder, and schedule undo.
