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
Every row names its route and test explicitly. Backup inventory rows use real
invalid requests or disposable-storage route cases to establish reachability.
Defensive injected backup, Project mutation Prisma (create and update),
Focus, focus-queue, and fieldless Time Block serializers appear only in
Appendix A; they are not part of the reachable HTTP inventory.

Activity POST mutation-id, receipt, and attribution rows use real request inputs
and transaction delegates that return missing relationships, conflicting attribution,
or mismatched/corrupt receipts. Each cited guard test asserts the exact envelope,
expected lookups, and no writes. The separate “Activity error mapping pins every
typed and Prisma branch” test pins serializer behavior; its remaining injected
POST/PUT failures characterize transaction-seam mapping, not guard reachability.

## Bootstrap, reads, and exports

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/bootstrap` | Prisma `P2021` or `P2022` (database migration required) | 503 | `{"code":"DATABASE_MIGRATION_REQUIRED","error":"Dayflow's local database needs an update. Stop Dayflow, run \`npm run db:migrate\`, then start Dayflow again."}` | `code`; no `field` | `tests/integration/bootstrap-startup-errors.test.ts` — “bootstrap tells the user how to update an outdated database” | Existing |
| `GET /api/bootstrap` | Any other failure | 500 | `{"code":"INTERNAL_ERROR","error":"Dayflow could not open its local data. Try again."}` | `code`; no `field` | `tests/integration/bootstrap-startup-errors.test.ts` — “bootstrap tells the user how to update an outdated database” | New |
| `GET /api/day` | Invalid or out-of-range `date`; example `2026-02-30` | 400 | `{"error":"That day is not a real calendar date.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/day-route-contracts.test.ts` — “Day route pins its validation envelope” | New |
| `GET /api/day` | Any other failure | 500 | `{"error":"That day could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/day-route-contracts.test.ts` — “Day route pins its internal envelope” | New |
| `GET /api/exports/:kind` | Unsupported kind | 404 | `{"error":"CSV export not found.","code":"EXPORT_NOT_FOUND"}` | `code`; no `field` | `tests/unit/csv-export-route-contracts.test.ts` — “CSV export route rejects unsupported kinds without attachment headers” | Existing |
| `GET /api/exports/:kind` | Export failure | 500 | `{"error":"CSV export could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/csv-export-route-contracts.test.ts` — “CSV export route pins its internal error envelope” | New |

`GET /api/agent-export` has no non-2xx JSON branch. Its success-payload keys
and read invariants are pinned by `tests/integration/read-model-invariants.test.ts`.

## Backup boundaries

Guard and parser rows use real invalid HTTP requests. Management rows use
`backup routes expose selected-backup errors through disposable storage`:
invalid/missing identifiers on restore and download, disabled restore, a staged
restore, cancellation without a pending restore, and a corrupted managed artifact.
The operation-running cases hold the real startup operation open on a live
owner file in disposable storage; they differ from the pending-restore conflict.
Fallback rows use a configured backup directory below a regular file (`ENOTDIR`).
Corrupt download also proves its 500 fallback: download uses
`openVerifiedManagedBackup`, whereas restore's `resolveVerifiedBackup` converts
inspection failures into the specific 422 envelope. No reachable backup row
uses an exception injected into `headers.get`. See Appendix A for those pins.

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/backups` | Missing `X-Dayflow-Local-Action: 1` | 403 | `{"error":"This local data action requires an explicit Dayflow request.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `PUT /api/backups/automatic` | Missing `X-Dayflow-Local-Action: 1` | 403 | `{"error":"This local data action requires an explicit Dayflow request.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups/restore` | Missing `X-Dayflow-Local-Action: 1` | 403 | `{"error":"This local data action requires an explicit Dayflow request.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `DELETE /api/backups/restore` | Missing `X-Dayflow-Local-Action: 1` | 403 | `{"error":"This local data action requires an explicit Dayflow request.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups` | Content type is not `application/json` | 415 | `{"error":"Use application/json for local data actions.","code":"UNSUPPORTED_MEDIA_TYPE"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `PUT /api/backups/automatic` | Content type is not `application/json` | 415 | `{"error":"Use application/json for local data actions.","code":"UNSUPPORTED_MEDIA_TYPE"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups/restore` | Content type is not `application/json` | 415 | `{"error":"Use application/json for local data actions.","code":"UNSUPPORTED_MEDIA_TYPE"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `DELETE /api/backups/restore` | Content type is not `application/json` | 415 | `{"error":"Use application/json for local data actions.","code":"UNSUPPORTED_MEDIA_TYPE"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups` | `Origin` differs from request origin | 403 | `{"error":"Cross-origin local data actions are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `PUT /api/backups/automatic` | `Origin` differs from request origin | 403 | `{"error":"Cross-origin local data actions are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups/restore` | `Origin` differs from request origin | 403 | `{"error":"Cross-origin local data actions are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `DELETE /api/backups/restore` | `Origin` differs from request origin | 403 | `{"error":"Cross-origin local data actions are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `GET /api/backups` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `PUT /api/backups/automatic` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups/restore` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `DELETE /api/backups/restore` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `GET /api/backups/automatic` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `GET /api/backups/:id/download` | `Sec-Fetch-Site` is neither `same-origin` nor `none` | 403 | `{"error":"Cross-site local data requests are not allowed.","code":"FORBIDDEN"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup handler pins its applicable request guards” | New |
| `POST /api/backups/restore` | Invalid backup identifier; `invalid` example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `GET /api/backups/:id/download` | Invalid backup identifier; `invalid` example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups/restore` | Valid backup identifier absent from managed storage | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `GET /api/backups/:id/download` | Valid backup identifier absent from managed storage | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups/restore` | Another restore has already been staged | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups/restore` | Corrupt/incompatible managed backup | 422 | `{"error":"The selected backup is corrupt or incompatible and cannot be restored.","code":"CORRUPT_BACKUP","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups/restore` | Restore disabled in this process | 503 | `{"error":"Restore scheduling is disabled in this Dayflow process.","code":"RESTORE_DISABLED"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `DELETE /api/backups/restore` | No restore is pending (cancellation does not select a backup) | 404 | `{"error":"No restore is currently pending.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups` | Another backup operation is running (startup restore waits on a live owner) | 409 | `{"error":"Another backup operation is already running.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `PUT /api/backups/automatic` | Another backup operation is running (startup restore waits on a live owner) | 409 | `{"error":"Another backup operation is already running.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `POST /api/backups/restore` | Another backup operation is running (startup restore waits on a live owner) | 409 | `{"error":"Another backup operation is already running.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `DELETE /api/backups/restore` | Another backup operation is running (startup restore waits on a live owner) | 409 | `{"error":"Another backup operation is already running.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup routes expose selected-backup errors through disposable storage” | New |
| `GET /api/backups` | Unexpected list failure | 500 | `{"error":"Backup list could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `POST /api/backups` | Unexpected creation failure | 500 | `{"error":"Backup creation could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `GET /api/backups/automatic` | Unexpected automatic-settings failure | 500 | `{"error":"Automatic backup settings could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `PUT /api/backups/automatic` | Unexpected automatic-settings failure | 500 | `{"error":"Automatic backup settings could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `GET /api/backups/:id/download` | Unexpected download failure | 500 | `{"error":"Backup download could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `POST /api/backups/restore` | Unexpected scheduling failure | 500 | `{"error":"Restore scheduling could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `DELETE /api/backups/restore` | Unexpected cancellation failure | 500 | `{"error":"Restore cancellation could not be completed.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup handlers select their operation-specific fallback bodies from storage failures” | New |
| `POST /api/backups` | Malformed JSON | 400 | `{"error":"The request body must be valid JSON.","code":"INVALID_JSON"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `PUT /api/backups/automatic` | Malformed JSON | 400 | `{"error":"The request body must be valid JSON.","code":"INVALID_JSON"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `POST /api/backups/restore` | Malformed JSON | 400 | `{"error":"The request body must be valid JSON.","code":"INVALID_JSON"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `DELETE /api/backups/restore` | Malformed JSON | 400 | `{"error":"The request body must be valid JSON.","code":"INVALID_JSON"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `POST /api/backups` | Body is not an object | 400 | `{"error":"The request body must be a JSON object.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `PUT /api/backups/automatic` | Body is not an object | 400 | `{"error":"The request body must be a JSON object.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `POST /api/backups/restore` | Body is not an object | 400 | `{"error":"The request body must be a JSON object.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `DELETE /api/backups/restore` | Body is not an object | 400 | `{"error":"The request body must be a JSON object.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “every backup parser method pins malformed JSON and non-object bodies” | New |
| `POST /api/backups` | Body contains any field | 400 | `{"error":"Backup creation does not accept a destination path.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `POST /api/backups/restore` | Unexpected field `unexpected` | 400 | `{"error":"Unexpected restore field: unexpected.","code":"VALIDATION_ERROR","field":"unexpected"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `POST /api/backups/restore` | `backupId` is absent/not text | 400 | `{"error":"Choose a managed backup.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `POST /api/backups/restore` | `expectedPayloadSha256` is absent/not text | 400 | `{"error":"The selected backup checksum is required.","code":"VALIDATION_ERROR","field":"expectedPayloadSha256"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `POST /api/backups/restore` | `confirmation` is absent/not text or is not exactly `RESTORE` | 400 | `{"error":"Type RESTORE exactly to schedule replacement.","code":"VALIDATION_ERROR","field":"confirmation"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “restore confirmation pins absent non-string and incorrect text bodies” | New |
| `DELETE /api/backups/restore` | Body contains any field | 400 | `{"error":"Canceling a restore does not accept any fields.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “backup route-specific validation envelopes are exact” | New |
| `PUT /api/backups/automatic` | Invalid policy; zero `intervalHours` example | 400 | `{"error":"The backup interval in hours must be a whole number between 1 and 168.","code":"VALIDATION_ERROR","field":"intervalHours"}` | `code`, `field` | `tests/unit/automatic-backup-route-contracts.test.ts` — “automatic backup policy errors preserve their exact envelope” | New |

## Tasks, Time Blocks, and queue workflows

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/tasks` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task routes validate mutation and path identifiers before writing” | Existing |
| `POST /api/tasks` | Receipt id reused for a different request | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins its own mismatch and corrupt receipt bodies” | New |
| `POST /api/tasks` | Stored receipt JSON cannot be decoded | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins its own mismatch and corrupt receipt bodies” | New |
| `POST /api/tasks` | Invalid create body; negative estimate example | 400 | `{"error":"Estimate must be a whole number from 0 to 1440 minutes.","code":"VALIDATION_ERROR","field":"estimateMinutes"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch expose typed validation fields” | Existing |
| `POST /api/tasks` | Phase supplied without Project | 400 | `{"error":"A task cannot have a phase without a project.","code":"VALIDATION_ERROR","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Phase supplied without Project | 400 | `{"error":"A task cannot have a phase without a project.","code":"VALIDATION_ERROR","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/tasks` | Selected Project missing | 404 | `{"error":"The selected project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Selected Project missing | 404 | `{"error":"The selected project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/tasks` | Selected Phase missing | 404 | `{"error":"The selected phase could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Selected Phase missing | 404 | `{"error":"The selected phase could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/tasks` | Selected Phase belongs to another Project | 409 | `{"error":"The selected phase does not belong to this project.","code":"RELATIONSHIP_CONFLICT","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Selected Phase belongs to another Project | 409 | `{"error":"The selected phase does not belong to this project.","code":"RELATIONSHIP_CONFLICT","field":"phaseId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/tasks` | Prisma `P2003` | 409 | `{"error":"The selected task relationship is no longer available.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `POST /api/tasks` | Unexpected failure | 500 | `{"error":"Task could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task create pins placement, Prisma P2003, and internal envelopes” | New |
| `PATCH /api/tasks/:id` | Invalid status | 400 | `{"error":"Task status is invalid.","code":"VALIDATION_ERROR","field":"status"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch expose typed validation fields” | Existing |
| `PATCH /api/tasks/:id` | Pre-read misses Task, or Prisma `P2025` race | 404 | `{"error":"Task not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/integration/transactional-workflows.test.ts` — “task update translates a P2025 not-found race and restores the row” | New |
| `PATCH /api/tasks/:id` | Prisma `P2003` | 409 | `{"error":"A related record changed before the task could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `PATCH /api/tasks/:id` | Unexpected failure | 500 | `{"error":"Task could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `DELETE /api/tasks/:id` | Invalid id | 400 | `{"error":"Task identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task routes validate mutation and path identifiers before writing” | Existing |
| `DELETE /api/tasks/:id` | Prisma `P2025` | 404 | `{"error":"Task not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `DELETE /api/tasks/:id` | Prisma `P2003` | 409 | `{"error":"A related record changed before the task could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `DELETE /api/tasks/:id` | Unexpected failure | 500 | `{"error":"Task could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/task-route-contracts.test.ts` — “Task item routes pin P2025, P2003, and action-specific fallbacks” | New |
| `POST /api/tasks/reorder` | Invalid ids | 400 | `{"error":"Task identifiers must not contain duplicates.","code":"VALIDATION_ERROR","field":"ids"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `POST /api/tasks/reorder` | Any requested Task missing | 404 | `{"error":"One or more tasks could not be found.","code":"NOT_FOUND","field":"ids"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/reorder` | Prisma `P2025` | 409 | `{"error":"A task changed before its order could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/reorder` | Unexpected failure | 500 | `{"error":"Task order could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/:id/schedule/undo` | Invalid id | 400 | `{"error":"Task identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “path-based workflow routes reject invalid identifiers before querying” | Existing |
| `POST /api/tasks/:id/schedule/undo` | Task missing | 404 | `{"error":"Task not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/:id/schedule/undo` | No schedule change remains | 404 | `{"error":"There is no schedule change to undo.","code":"NOT_FOUND","field":"scheduleChange"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/:id/schedule/undo` | Claim conflict, Prisma `P2003`, or Prisma `P2025` | 409 | `{"error":"The schedule changed before it could be undone.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/tasks/:id/schedule/undo` | Unexpected failure | 500 | `{"error":"The schedule change could not be undone.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create validates mutation identifiers before writing” | Existing |
| `POST /api/time-blocks` | Receipt payload mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Invalid draft; bad date example | 400 | `{"error":"Time Block date must be a valid local date in YYYY-MM-DD format.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create and replace pin invalid date bodies” | Existing |
| `PUT /api/time-blocks/:id` | Invalid draft; bad date example | 400 | `{"error":"Time Block date must be a valid local date in YYYY-MM-DD format.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create and replace pin invalid date bodies” | New |
| `POST /api/time-blocks` | Selected Task missing, including Prisma `P2003` | 404 | `{"error":"The selected Task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Selected Task missing, including Prisma `P2003` | 404 | `{"error":"The selected Task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Task/day relationship conflict | 409 | `{"error":"Choose an unfinished Task scheduled for the same day as the Time Block.","code":"RELATIONSHIP_CONFLICT","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Task/day relationship conflict | 409 | `{"error":"Choose an unfinished Task scheduled for the same day as the Time Block.","code":"RELATIONSHIP_CONFLICT","field":"taskId"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Overlap | 409 | `{"error":"This Time Block overlaps \"Planning\" at 09:00–10:00.","code":"TIME_BLOCK_OVERLAP","field":"startTime"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Overlap | 409 | `{"error":"This Time Block overlaps \"Planning\" at 09:00–10:00.","code":"TIME_BLOCK_OVERLAP","field":"startTime"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Missing row or Prisma `P2025` | 404 | `{"error":"Time Block not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `DELETE /api/time-blocks/:id` | Missing row or Prisma `P2025` | 404 | `{"error":"Time Block not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/time-blocks` | Unexpected failure | 500 | `{"error":"Time Block could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Unexpected failure | 500 | `{"error":"Time Block could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `DELETE /api/time-blocks/:id` | Unexpected failure | 500 | `{"error":"Time Block could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/focus-queue` | Invalid placement | 400 | `{"error":"Queue placement must be next or end.","code":"VALIDATION_ERROR","field":"placement"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `POST /api/focus-queue` | Task missing | 404 | `{"error":"Task not found.","code":"NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `POST /api/focus-queue` | Task already completed | 409 | `{"error":"Completed tasks cannot be queued.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `PATCH /api/focus-queue` | Expected queue order is stale | 409 | `{"error":"Queue order is out of date. Refresh and try again.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `POST /api/focus-queue` | Unexpected failure | 500 | `{"error":"Focus queue could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes”; `tests/unit/workflow-route-contracts.test.ts` — “Focus queue PATCH and DELETE pin their validation and fallback bodies” | New |
| `PATCH /api/focus-queue` | Unexpected failure | 500 | `{"error":"Focus queue could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes”; `tests/unit/workflow-route-contracts.test.ts` — “Focus queue PATCH and DELETE pin their validation and fallback bodies” | New |
| `DELETE /api/focus-queue` | Unexpected failure | 500 | `{"error":"Focus queue could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes”; `tests/unit/workflow-route-contracts.test.ts` — “Focus queue PATCH and DELETE pin their validation and fallback bodies” | New |

## Projects and Phases

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/projects/:id` | Project missing | 404 | `{"error":"Project not found."}` | no `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project detail keeps its legacy code-less not-found envelope” | New |
| `POST /api/projects` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase creates validate mutation identifiers before writing” | Existing |
| `POST /api/projects` | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin their own mismatch and corrupt receipt bodies” | New |
| `POST /api/projects` | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin their own mismatch and corrupt receipt bodies” | New |
| `POST /api/projects` | Invalid body; negative weekly budget example | 400 | `{"error":"Weekly effort budget must be a whole number from 1 to 10080 minutes.","code":"VALIDATION_ERROR","field":"weeklyMinutesBudget"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes expose typed validation fields” | Existing |
| `POST /api/projects` | Unexpected failure | 500 | `{"error":"Project could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| `PATCH /api/projects/:id` | Invalid body or id | 400 | `{"error":"Project identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| `PATCH /api/projects/:id` | Project absent or Prisma `P2025` | 404 | `{"error":"Project not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `PATCH /api/projects/:id` | Unfinished Tasks and no completion confirmation | 409 | `{"error":"Confirm completion while unfinished tasks remain.","code":"CONFLICT","field":"status","requiresConfirmation":true}` | `code`, `field`, plus `requiresConfirmation` | `tests/integration/transactional-workflows.test.ts` — “Project completion with unfinished Tasks requires confirmation and changes nothing” | New |
| `PATCH /api/projects/:id` | Unexpected failure | 500 | `{"error":"Project could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `DELETE /api/projects/:id` | Missing `confirm=true` | 400 | `{"error":"Project deletion requires confirmation.","code":"VALIDATION_ERROR","field":"confirm"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project deletion requires a typed confirmation response” | Existing |
| `DELETE /api/projects/:id` | Project absent or Prisma `P2025` | 404 | `{"error":"Project not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `DELETE /api/projects/:id` | Prisma `P2003` | 409 | `{"error":"A related record changed before the Project could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `DELETE /api/projects/:id` | Unexpected failure | 500 | `{"error":"Project could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks”; `tests/integration/transactional-workflows.test.ts` — “Project deletion rolls back every detachment when the final delete fails” (real final-delete constraint failure) | New |
| `POST /api/projects/:id/phases` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase creates validate mutation identifiers before writing” | Existing |
| `POST /api/projects/:id/phases` | Parent Project absent | 404 | `{"error":"The selected project could not be found.","code":"NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| `POST /api/projects/:id/phases` | Prisma `P2003` | 409 | `{"error":"The selected Project is no longer available.","code":"CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| `POST /api/projects/:id/phases` | Unexpected failure | 500 | `{"error":"Phase could not be created.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| `PATCH /api/phases/:id` | Invalid body/id | 400 | `{"error":"Phase order must be a whole number from 0 to 2147483647.","code":"VALIDATION_ERROR","field":"sortOrder"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes expose typed validation fields” | Existing |
| `PATCH /api/phases/:id` | Prisma `P2025` | 404 | `{"error":"Phase not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `PATCH /api/phases/:id` | Unexpected failure | 500 | `{"error":"Phase could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `DELETE /api/phases/:id` | Invalid id | 400 | `{"error":"Phase identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| `DELETE /api/phases/:id` | Prisma `P2025` | 404 | `{"error":"Phase not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |
| `DELETE /api/phases/:id` | Unexpected failure | 500 | `{"error":"Phase could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |

## Focus and Activity

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/focus-session` | Snapshot load failure | 500 | `{"error":"Focus timer could not be loaded.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus snapshot GET pins its internal envelope” | New |
| `POST /api/focus-session` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus POST pins invalid mutation identifiers through its handler” | New |
| `POST /api/focus-session` | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/integration/focus-session-idempotency.test.ts` — “reusing an identifier for a different Focus start payload is rejected” | Existing |
| `POST /api/focus-session` | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `POST /api/focus-session` | Invalid body; nonnumeric duration example | 400 | `{"error":"Timer duration must be between 1 and 240 minutes.","code":"VALIDATION_ERROR","field":"plannedMinutes"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `POST /api/focus-session` | Selected Task missing | 404 | `{"error":"The selected task could not be found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `POST /api/focus-session` | Selected Project missing | 404 | `{"error":"The selected project could not be found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `POST /api/focus-session` | Existing active session or Prisma `P2002` active-key conflict | 409 | `{"error":"Finish or cancel the active timer first.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes”; `tests/integration/focus-session-idempotency.test.ts` — “different simultaneous starts resolve as one created session and conflicts for every other request” | New |
| `POST /api/focus-session` | Task belongs to different Project | 409 | `{"error":"The selected task belongs to a different project.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `POST /api/focus-session` | Prisma `P2003` | 409 | `{"error":"A selected Focus relationship changed before the timer started.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `POST /api/focus-session` | Unexpected failure | 500 | `{"error":"Focus timer could not be started.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes” | New |
| `PATCH /api/focus-session/:id` | Invalid input/id | 400 | `{"error":"Unknown timer action.","code":"VALIDATION_ERROR","field":"action"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow routes expose typed validation fields before persistence” | Existing |
| `PATCH /api/focus-session/:id` | Session missing | 404 | `{"error":"Focus session not found.","code":"NOT_FOUND","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus transition pins not-found, conflict, Prisma, and fallback envelopes” | New |
| `PATCH /api/focus-session/:id` | State transition conflict | 409 | `{"error":"Only a running timer can be paused.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus transition pins not-found, conflict, Prisma, and fallback envelopes” | New |
| `PATCH /api/focus-session/:id` | Prisma `P2003` or `P2025` | 409 | `{"error":"The Focus session changed before it could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus transition pins not-found, conflict, Prisma, and fallback envelopes” | New |
| `PATCH /api/focus-session/:id` | Unexpected failure | 500 | `{"error":"Focus timer could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus transition pins not-found, conflict, Prisma, and fallback envelopes” | New |
| `POST /api/activities` | Invalid mutation id | 400 | `{"error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters.","code":"INVALID_MUTATION_ID"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches invalid mutation id through its own guards” | New |
| `POST /api/activities` | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches receipt mismatch through its own guards” | New |
| `POST /api/activities` | Invalid stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches invalid stored receipt through its own guards” | New |
| `POST /api/activities` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| `POST /api/activities` | Linked Task missing | 404 | `{"error":"The linked task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches linked Task missing through its own guards” | New |
| `POST /api/activities` | Linked Project missing | 404 | `{"error":"The linked project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches linked Project missing through its own guards” | New |
| `POST /api/activities` | Attribution conflict | 409 | `{"error":"The selected task belongs to a different project.","code":"ATTRIBUTION_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity POST reaches attribution conflict through its own guards” | New |
| `POST /api/activities` | Prisma `P2003` or `P2025` | 409 | `{"error":"The linked Activity relationship is no longer available.","code":"RELATIONSHIP_CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `POST /api/activities` | Unexpected failure | 500 | `{"error":"Activity could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Invalid input/id | 400 | `{"error":"Activity identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity replacement route validates the path and full body before writing” | Existing |
| `PUT /api/activities/:id` | Activity missing | 404 | `{"error":"Activity not found.","code":"ACTIVITY_NOT_FOUND"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Focus-origin Activity | 409 | `{"error":"Focus evidence cannot be edited here.","code":"FOCUS_ACTIVITY_PROTECTED"}` | `code`; no `field` | `tests/integration/transactional-workflows.test.ts` — “Activity replace and delete protect Focus-origin evidence” | New |
| `PUT /api/activities/:id` | Stale `updatedAt` | 409 | `{"error":"The Activity changed before it could be updated.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Linked Task missing | 404 | `{"error":"The linked task could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"taskId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Linked Project missing | 404 | `{"error":"The linked project could not be found.","code":"RELATIONSHIP_NOT_FOUND","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Attribution mismatch | 409 | `{"error":"The selected task belongs to a different project.","code":"ATTRIBUTION_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Prisma `P2003` or `P2025` | 409 | `{"error":"The linked Activity relationship is no longer available.","code":"RELATIONSHIP_CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `PUT /api/activities/:id` | Unexpected failure | 500 | `{"error":"Activity could not be updated.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity error mapping pins every typed and Prisma branch” | New |
| `DELETE /api/activities/:id` | Invalid id | 400 | `{"error":"Activity identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “path-based workflow routes reject invalid identifiers before querying” | Existing |
| `DELETE /api/activities/:id` | Activity missing | 404 | `{"error":"Activity not found."}` | no `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| `DELETE /api/activities/:id` | Focus-origin Activity | 409 | `{"error":"Focus evidence cannot be deleted."}` | no `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes”; `tests/integration/transactional-workflows.test.ts` — “Activity replace and delete protect Focus-origin evidence” | New |
| `DELETE /api/activities/:id` | Optimistic delete conflict, Prisma `P2003`, or Prisma `P2025` | 409 | `{"error":"The Activity changed before it could be deleted.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| `DELETE /api/activities/:id` | Unexpected failure | 500 | `{"error":"Activity could not be deleted.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity delete pins its code-less and conflict envelopes” | New |
| `PUT /api/diary` | Invalid input | 400 | `{"error":"Diary date must be a valid calendar date.","code":"VALIDATION_ERROR","field":"date"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| `PUT /api/diary` | Unexpected failure | 500 | `{"error":"Diary could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Diary route pins its internal envelope” | New |

## Journal and Review

Journal routes intentionally use `{code, error}` and never emit `field`, even
when a relationship or validation condition is field-specific.

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/notes` | Invalid cursor | 400 | `{"code":"INVALID_CURSOR","error":"The pagination cursor is invalid."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| `GET /api/notes` | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"Notes could not be loaded."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| `POST /api/notes` | Malformed JSON | 400 | `{"code":"INVALID_JSON","error":"Request body must be valid JSON."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| `POST /api/notes` | Invalid input | 400 | `{"code":"VALIDATION_ERROR","error":"Write something before saving this note."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| `POST /api/notes` | Invalid mutation id | 400 | `{"code":"INVALID_MUTATION_ID","error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Note and Material routes validate mutation identifiers before writing” | Existing |
| `POST /api/notes` | Receipt mismatch | 409 | `{"code":"MUTATION_ID_CONFLICT","error":"This mutation identifier was already used for a different request."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/notes` | Invalid stored receipt | 500 | `{"code":"INVALID_MUTATION_RECEIPT","error":"The saved mutation receipt could not be read."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/notes` | Linked Task missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked task could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/notes` | Linked Project missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked project could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/notes` | Attribution conflict | 409 | `{"code":"ATTRIBUTION_CONFLICT","error":"The selected task belongs to a different project."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/notes` | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"The note could not be saved."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `GET /api/materials` | Unsupported tag filter | 400 | `{"code":"VALIDATION_ERROR","error":"Tag filtering is available only for Notes."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| `GET /api/materials` | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"References could not be loaded."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes keep the code-error shape for validation and internal failures” | New |
| `POST /api/materials` | Malformed JSON | 400 | `{"code":"INVALID_JSON","error":"Request body must be valid JSON."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| `POST /api/materials` | Invalid input; missing URL example | 400 | `{"code":"VALIDATION_ERROR","error":"Add a URL before saving this reference."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| `POST /api/materials` | Invalid mutation id | 400 | `{"code":"INVALID_MUTATION_ID","error":"X-Dayflow-Mutation-Id must contain 1 to 128 characters."}` | `code`; no `field` | `tests/unit/evidence-route-contracts.test.ts` — “Note and Material routes validate mutation identifiers before writing” | Existing |
| `POST /api/materials` | Receipt mismatch | 409 | `{"code":"MUTATION_ID_CONFLICT","error":"This mutation identifier was already used for a different request."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Materials POST pins receipt and attribution bodies through its handler” | New |
| `POST /api/materials` | Invalid stored receipt | 500 | `{"code":"INVALID_MUTATION_RECEIPT","error":"The saved mutation receipt could not be read."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Materials POST pins receipt and attribution bodies through its handler” | New |
| `POST /api/materials` | Linked Task missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked task could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/materials` | Linked Project missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked project could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/materials` | Linked Note missing | 404 | `{"code":"RELATIONSHIP_NOT_FOUND","error":"The linked note could not be found."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `POST /api/materials` | Attribution conflict | 409 | `{"code":"ATTRIBUTION_CONFLICT","error":"The selected note belongs to a different project."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Materials POST pins receipt and attribution bodies through its handler” | New |
| `POST /api/materials` | Unexpected failure | 500 | `{"code":"INTERNAL_ERROR","error":"The reference could not be saved."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal POST routes pin relationship, receipt, and fallback envelopes without field” | New |
| `PUT /api/review` | Invalid body | 400 | `{"error":"Write a narrative or next-period intention before saving this Review.","code":"VALIDATION_ERROR","field":"review"}` | `code`, `field` | `tests/unit/review-route-contracts.test.ts` — “Review route returns typed malformed and empty mutation errors” | Existing |
| `PUT /api/review` | Review period changed | 409 | `{"error":"The Review Period changed. Refresh and try again.","code":"REVIEW_PERIOD_CHANGED","field":"reviewPeriod"}` | `code`, `field` | `tests/unit/review-route-contracts.test.ts` — “Review route rejects a stale exact period before persistence” | Existing |
| `PUT /api/review` | Unexpected failure | 500 | `{"error":"Review could not be saved.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/:id` | Invalid id | 400 | `{"error":"That Review identifier is not valid.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| `GET /api/review/:id` | Review missing | 404 | `{"error":"That Review no longer exists.","code":"REVIEW_NOT_FOUND"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| `GET /api/review/:id` | Unexpected failure | 500 | `{"error":"Review period could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/history` | Invalid cursor | 400 | `{"error":"That pagination cursor is no longer usable. Reload Review history.","code":"INVALID_CURSOR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| `GET /api/review/history` | Unexpected failure | 500 | `{"error":"Review history could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |
| `GET /api/review/window` | Missing/invalid ending day | 400 | `{"error":"Choose a Review Window ending day.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review read routes pin validation, cursor, and not-found envelopes” | New |
| `GET /api/review/window` | Unexpected failure | 500 | `{"error":"Review Window could not be read.","code":"INTERNAL_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review routes pin operation-specific internal envelopes” | New |

## Additional method and serializer variants pinned after review

| Route and method | Trigger | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/tasks` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch return typed malformed-JSON responses” | Existing |
| `PATCH /api/tasks/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task create and patch return typed malformed-JSON responses” | Existing |
| `POST /api/time-blocks` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create and replace return typed malformed-JSON responses” | Existing |
| `PUT /api/time-blocks/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block create and replace return typed malformed-JSON responses” | Existing |
| `POST /api/focus-queue` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `PATCH /api/focus-queue` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `DELETE /api/focus-queue` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `POST /api/focus-session` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `PATCH /api/focus-session/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `POST /api/tasks/reorder` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “workflow mutation routes return typed malformed-JSON responses” | Existing |
| `POST /api/projects` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes return typed malformed-JSON responses” | Existing |
| `PATCH /api/projects/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes return typed malformed-JSON responses” | Existing |
| `POST /api/projects/:id/phases` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes return typed malformed-JSON responses” | Existing |
| `PATCH /api/phases/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase routes return typed malformed-JSON responses” | Existing |
| `PUT /api/diary` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes return typed malformed-JSON responses” | Existing |
| `PUT /api/review` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/review-route-contracts.test.ts` — “Review route returns typed malformed and empty mutation errors” | Existing |
| `PUT /api/activities/:id` | Malformed JSON | 400 | `{"error":"Request body must be valid JSON.","code":"INVALID_JSON","field":"body"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “Activity replacement route validates the path and full body before writing” | Existing |
| `POST /api/activities` | Invalid duration | 400 | `{"error":"Duration must be between 1 and 1440 minutes.","code":"VALIDATION_ERROR","field":"durationMinutes"}` | `code`, `field` | `tests/unit/evidence-route-contracts.test.ts` — “evidence routes expose typed validation errors” | Existing |
| `DELETE /api/time-blocks/:id` | Invalid id | 400 | `{"error":"Time Block identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block item routes reject invalid path identifiers before querying” | Existing |
| `PUT /api/time-blocks/:id` | Invalid id | 400 | `{"error":"Time Block identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block item routes reject invalid path identifiers before querying” | Existing |
| `DELETE /api/projects/:id` | Invalid id with confirm=true | 400 | `{"error":"Project identifier is invalid.","code":"VALIDATION_ERROR","field":"id"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| `POST /api/projects/:id/phases` | Invalid parent id | 400 | `{"error":"Project identifier is invalid.","code":"VALIDATION_ERROR","field":"projectId"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase path identifiers are validated before querying” | Existing |
| `POST /api/projects/:id/phases` | Invalid name | 400 | `{"error":"Phase name is required.","code":"VALIDATION_ERROR","field":"name"}` | `code`, `field` | `tests/unit/project-route-contracts.test.ts` — “Phase create pins invalid input before persistence” | New |
| `GET /api/notes` | limit=0 | 400 | `{"code":"VALIDATION_ERROR","error":"Page limit must be a positive whole number."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes pin Notes validation and Materials cursor errors” | New |
| `GET /api/materials` | Invalid cursor | 400 | `{"code":"INVALID_CURSOR","error":"The pagination cursor is invalid."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Journal GET routes pin Notes validation and Materials cursor errors” | New |
| `GET /api/review/history` | limit=0 | 400 | `{"error":"Page limit must be a whole number between 1 and 100.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/review-route-contracts.test.ts` — “Review History GET pins query validation without a field” | New |
| `POST /api/materials` | Selected Task belongs to another Project | 409 | `{"code":"ATTRIBUTION_CONFLICT","error":"The selected task belongs to a different project."}` | `code`; no `field` | `tests/unit/journal-route-contracts.test.ts` — “Materials POST pins receipt and attribution bodies through its handler” | New |
| `PATCH /api/focus-queue` | Duplicate ids | 400 | `{"error":"Task identifiers must not contain duplicates.","code":"VALIDATION_ERROR","field":"ids"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue PATCH and DELETE pin their validation and fallback bodies” | New |
| `DELETE /api/focus-queue` | Empty taskId | 400 | `{"error":"Task identifier is invalid.","code":"VALIDATION_ERROR","field":"taskId"}` | `code`, `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue PATCH and DELETE pin their validation and fallback bodies” | New |
| `POST /api/tasks` | Completed Project gains an unfinished Task | 409 | `{"error":"Reopen the completed project before adding unfinished work.","code":"RELATIONSHIP_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/tasks` | Archived Project gains an unfinished Task | 409 | `{"error":"Restore the archived project before adding unfinished work.","code":"RELATIONSHIP_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Completed Project gains an unfinished Task | 409 | `{"error":"Reopen the completed project before adding unfinished work.","code":"RELATIONSHIP_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `PATCH /api/tasks/:id` | Archived Project gains an unfinished Task | 409 | `{"error":"Restore the archived project before adding unfinished work.","code":"RELATIONSHIP_CONFLICT","field":"projectId"}` | `code`, `field` | `tests/unit/task-route-contracts.test.ts` — “Task POST and PATCH pin each placement error independently” | New |
| `POST /api/projects/:id/phases` | Receipt mismatch | 409 | `{"error":"This mutation identifier was already used for a different request.","code":"MUTATION_ID_CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin their own mismatch and corrupt receipt bodies” | New |
| `POST /api/projects/:id/phases` | Corrupt stored receipt | 500 | `{"error":"The saved mutation receipt could not be read.","code":"INVALID_MUTATION_RECEIPT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin their own mismatch and corrupt receipt bodies” | New |

## Findings

- `GET /api/agent-export` includes every stored Activity with no date cutoff,
  preserving README's complete-export contract and the route's metadata.
  The read-model fixture pins historical, current-day, and tomorrow's Activities
  in ascending order. Bootstrap returns only the current half-open local day,
  including its last millisecond and excluding tomorrow at midnight.
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
- Bootstrap bounds Activity evidence by local calendar day, not by the current
  instant. The invariant fixture fixes September 4 at noon in America/Chicago
  and retains later-today evidence. Agent export has no date cutoff.
- Notes reject `limit=0` with “Page limit must be a positive whole number.”;
  Review History uses “Page limit must be a whole number between 1 and 100.”
  Both omit `field`. Their distinct HTTP bodies are pinned above.
- The fieldless Time Block domain-error arm, two fieldless Focus validation
  arms, fieldless focus-queue validation arm, and Project create/update Prisma
  P2003 arms are defensive serializer contracts documented in Appendix A.
  Their mapper tests remain unchanged.

## Appendix A — Defensive serializers (not reachable inventory)

### Focus, focus queue, and neighboring Time Block serializer

These four rows are serializer pins, not reachable HTTP envelopes:

- Focus POST calls `parseFocusSessionStartMutation` before `startFocusSession`.
  Its integer range check rejects invalid `plannedMinutes` with a field-bearing
  `WorkflowMutationRequestError`; the service's same range check is preempted.
  The mapper test instead makes `$transaction` throw a constructed error.
- Focus PATCH calls `parseFocusSessionTransitionMutation` before
  `transitionFocusSession`. Its action enum rejects unknown actions with
  `field: "action"`; every accepted action has a service branch (`record` aliases
  `enrich`). The mapper test injects the fieldless error through `findUnique`.
- Focus-queue POST calls `parseFocusQueueAddMutation`, whose placement enum
  produces `field: "placement"`. The only production `new FocusQueueError`
  is in `parseQueuePlacement`, which no handler calls. The mapper test replaces
  `$transaction` with a thrower. Neighboring missing-Task and completed-Task
  responses come from real guards in `addToFocusQueue`; stale order comes from
  `reorderFocusQueue`. Those reachable rows remain above.
- The neighboring Time Block PUT fieldless 404 has the same problem. All
  `TimeBlockError` constructors in `time-blocks.ts` and
  `time-block-persistence.ts` supply fields; the missing-row guard uses `id`,
  as does the `P2025` mapper in `time-block-http.ts`. The cited test constructs
  a fieldless error and injects it via the transaction. Field-bearing missing
  row, relationship, parser, and overlap responses remain reachable.

| Route and method | Injected error (not an HTTP trigger) | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/focus-queue` | Defensive `FocusQueueError`; bad placement example | 400 | `{"error":"Queue placement must be next or end.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus queue pins not-found, conflict, and fallback envelopes” | New |
| `PUT /api/time-blocks/:id` | Injected fieldless TimeBlockError (defensive mapper branch) | 404 | `{"error":"Time Block not found.","code":"NOT_FOUND"}` | `code`; no `field` | `tests/unit/time-block-route-contracts.test.ts` — “Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes” | New |
| `POST /api/focus-session` | Injected FocusSessionError (preempted by request validation) | 400 | `{"error":"Timer duration must be between 1 and 240 minutes.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus handlers preserve defensive fieldless validation envelopes” | New |
| `PATCH /api/focus-session/:id` | Injected FocusSessionError (preempted by request validation) | 400 | `{"error":"Unknown timer action.","code":"VALIDATION_ERROR"}` | `code`; no `field` | `tests/unit/workflow-route-contracts.test.ts` — “Focus handlers preserve defensive fieldless validation envelopes” | New |

### Project creation and update

Neither `POST /api/projects` nor `PATCH /api/projects/:id` can produce `P2003`
through current writes:

- `POST /api/projects`: `parseProjectCreateMutation` returns scalar Project fields,
  `project.create` writes no foreign keys or nested relations, and
  `getProjectDetail` only reads. The optional `MutationReceipt` created by
  `runIdempotentCreate` has no relations in `prisma/schema.prisma`.
- `PATCH /api/projects/:id`: `parseProjectPatchMutation` permits only scalar
  Project fields (`name`, `desiredOutcome`, `targetDate`, `weeklyMinutesBudget`,
  `targetDurationValue`, `targetDurationUnit`, `status`). The transaction does reads
  (`findUnique` and optional `task.count`), a scalar `project.update`, and
  `getProjectDetail` (which only reads).
- `Project` itself has no foreign key references to any other model in
  `prisma/schema.prisma`.

In each case, these envelopes exist in the mapper as defence in depth, they are
exercised only by fault injection where the test replaces `$transaction` with a
function that throws, and they are not reachable through the current handler and
schema. Keep them as defensive serializer coverage.

The other rows on these routes remain applicable and reachable: malformed JSON,
invalid mutation id or route id, and invalid body are request validation;
mismatched and corrupt stored receipts have explicit guards; missing Project or
P2025 race returns 404; unfinished task completion conflict returns 409; and
unexpected persistence/readback failures reach the generic 500. None requires a
nonexistent foreign-key write.

| Route and method | Injected error (not an HTTP trigger) | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `POST /api/projects` | Injected Prisma `P2003` (no foreign-key write) | 409 | `{"error":"A related record changed before the Project could be created.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase create pin Prisma and internal envelopes” | New |
| `PATCH /api/projects/:id` | Injected Prisma `P2003` (no foreign-key write) | 409 | `{"error":"A related record changed before the Project could be saved.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/project-route-contracts.test.ts` — “Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks” | New |

### Backup boundaries

These 17 rows were moved out of the reachable inventory. The cited test throws
constructed `BackupManagementError` instances from `request.headers.get` to pin
the shared serializer at each handler. This deliberately bypasses operation
inputs and storage: it proves status/body serialization, not HTTP reachability.
GET automatic settings has no backup identifier; cancellation has its own
fieldless 404; only restore scheduling emits the pending-restore conflict and
the restore-specific corrupt-backup 422. Keep these defensive mapper tests even
though the following operation/envelope combinations are not reachable.

| Route and method | Injected error (not an HTTP trigger) | Status | Exact JSON body | Keys | Contract test | Pin |
| --- | --- | ---: | --- | --- | --- | --- |
| `GET /api/backups` | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `POST /api/backups` | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `PUT /api/backups/automatic` | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `DELETE /api/backups/restore` | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups/automatic` | `BackupManagementError(VALIDATION_ERROR)`; invalid backup id example | 400 | `{"error":"The backup identifier is invalid.","code":"VALIDATION_ERROR","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups` | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `POST /api/backups` | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `PUT /api/backups/automatic` | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `DELETE /api/backups/restore` | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups/automatic` | `BackupManagementError(NOT_FOUND)` | 404 | `{"error":"The selected backup could not be found.","code":"NOT_FOUND","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `POST /api/backups` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `PUT /api/backups/automatic` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `DELETE /api/backups/restore` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups/automatic` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups/:id/download` | `BackupManagementError(CONFLICT)` | 409 | `{"error":"Another restore is already pending.","code":"CONFLICT"}` | `code`; no `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |
| `GET /api/backups/:id/download` | Corrupt/incompatible managed backup | 422 | `{"error":"The selected backup is corrupt or incompatible and cannot be restored.","code":"CORRUPT_BACKUP","field":"backupId"}` | `code`, `field` | `tests/unit/backup-route-contracts.test.ts` — “defensive backup serializers pin injected management statuses, optional fields, and fallback” | New |

The mapper test additionally injects the restore-specific 422 and 503 into every
handler, including operations never listed above. Those cross-operation probes
are also defensive serializer coverage only. Reachable versions of the same
bodies require the real route cases cited in the Backup boundaries table.
