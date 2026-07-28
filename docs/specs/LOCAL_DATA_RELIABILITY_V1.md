# Local Data Reliability v1

Status: Implemented
Date: July 27, 2026
Scope: Corrective release before further feature expansion

## Purpose

Dayflow is local-first and may become the user's personal system of record.
Local storage alone does not make it reliable: mutations must preserve drafts
through failure, reads must be complete and side-effect free, schema changes
must be repeatable, and the user must be able to back up and restore all data.

This specification defines the minimum reliability contract for that role.

## Goals

- Never discard user input before confirmed persistence.
- Give every mutation a validated, typed boundary.
- Make retries safe and recovery visible.
- Keep canonical Journal and history views complete.
- Replace manual schema pushing with versioned migrations.
- Provide a complete, portable backup and validated restore flow.
- Ensure reads do not mutate user evidence.

## Non-Goals

- Hosted synchronization.
- Multi-user conflict resolution.
- Real-time collaboration.
- Cloud backup.
- End-to-end encryption or password management.
- CSV as a lossless restore format.
- Indefinite undo for every edit.

## Reliability Principles

1. **A draft belongs to the user until persistence succeeds.**
2. **Silence is not success.** A mutation is successful only after a valid 2xx
   response containing the expected persisted result.
3. **Retries must not duplicate durable records.**
4. **Invalid input is a domain response, not a database exception.**
5. **Canonical views expose complete history or honest pagination.**
6. **GET requests are side-effect free.**
7. **Schema changes are versioned and reproducible.**
8. **Export is not backup unless it can restore the complete database.**
9. **Recovery is tested, not assumed.**

## Mutation Contract

### Client Behavior

For Task, Activity, Note, Material, Diary, Project, Phase, timer, and queue
mutations:

1. Keep the current draft and editing context while the request is pending.
2. Disable only controls whose repeated activation would be unsafe or confusing.
3. Parse the response and verify both HTTP success and the expected response
   shape.
4. Clear the draft only after confirmed persistence.
5. On failure:
   - preserve every entered value;
   - show an actionable error near the affected workflow;
   - provide retry without re-entry;
   - keep navigation possible unless leaving would destroy an unsaved draft.
6. On recovery, remove stale error state and announce success once.

Refreshing the global bootstrap payload is not proof that the preceding mutation
succeeded.

### Server Behavior

Every mutation endpoint must:

- parse JSON failures into a typed 400 response;
- validate required fields, enums, dates, numeric ranges, URLs where required,
  and relationship consistency;
- distinguish not found, conflict, and validation failures;
- perform related writes in one transaction;
- return the canonical persisted representation;
- avoid exposing ORM or database exception text;
- support idempotency where a network retry could create a duplicate.

### Idempotency

Create operations that can be retried automatically or from a preserved draft
must accept a client mutation identifier or have an equivalent natural unique
key. Repeating the same logical operation returns its original result.

Focus completion follows the stronger rules in
[Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md).

## Validation Baseline

The following minimum rules apply at the API boundary:

| Entity | Required validation |
| --- | --- |
| Task | Non-empty title; valid status; bounded non-negative estimate and scores; valid local date/deadline; existing Project and Phase; Phase belongs to Project |
| Activity | Positive bounded duration; valid timestamp; non-empty category and note policy; existing Task/Project; no conflicting attribution |
| Note | Non-empty content; normalized bounded tags; valid date; existing Task/Project; no conflicting attribution |
| Material | Non-empty valid URL; bounded title and notes; allowed type; existing Task/Note/Project; no conflicting attribution |
| Diary | Valid local date; bounded mood and energy; bounded content and reflection |
| Project | Non-empty name; valid lifecycle; positive optional duration and weekly budget |
| Phase | Non-empty name; existing Project; valid order; Task reassignment preserves Project consistency |
| Focus Session | Valid kind and duration; existing Task/Project; no conflicting attribution; one active session |

Exact length and numeric limits should be centralized in domain parsers and
shared by POST and PATCH handlers.

## Complete History Contract

### Journal

Journal is the canonical home for Notes, Materials, and Diary entries.

- Notes view can reach every Note, not only Notes from today.
- References view can reach every Material, not only the most recent fixed
  number.
- Daily view may intentionally show a limited “captured today” subset.
- List endpoints use stable cursor pagination or an explicitly complete result.
- Pagination exposes loading, empty, end, and failure states.
- Newly created items appear without removing older pages from reach.

### Review and Log

- Period queries declare their inclusive and exclusive boundaries.
- Changing a period never rewrites source evidence.
- Empty periods are represented as empty, not synthesized neutral values.

### Bootstrap

Bootstrap may return enough data for initial rendering, but it must not be the
only retrieval path for canonical history. It must not create Diary entries or
other evidence.

## Persistence and Migration Contract

### Versioned Migrations

- Every schema change has a checked-in Prisma migration.
- A fresh database and an existing prior-version database reach the same current
  schema through documented commands.
- Migrations preserve user data or fail before changing it.
- Data reconciliation scripts are repeatable and versioned alongside the schema
  change that needs them.
- `prisma db push` is a development convenience, not the supported upgrade path
  for user databases.

### Database Location and Ownership

- The active database path is explicit and visible to the user.
- Test and development databases cannot silently replace the user's database.
- Disposable tests use isolated temporary databases.
- Application startup never seeds or resets an existing user database.

## Backup Contract

A Dayflow backup is a versioned artifact containing everything required to
restore:

- Tasks and schedule-change history;
- Projects and Phases;
- Activities;
- Focus and Break Sessions;
- Notes and tags;
- Materials;
- Diary entries;
- time blocks and queue state;
- relationships, timestamps, stable identifiers, and schema version;
- settings that materially affect interpretation of the data.

The backup may be a validated database snapshot or a lossless structured
archive. CSV exports are supplemental and are not backups.

### Creating a Backup

- The user can create a backup from the UI or one documented command.
- Backup creation does not require stopping normal use for an unbounded time.
- The artifact is written atomically and never reported complete while partial.
- Dayflow reports the destination, timestamp, schema version, and record counts.
- Creating a backup does not mutate application records.

### Restoring a Backup

Restore is deliberately conservative:

1. Inspect and validate the archive before changing the active database.
2. Reject unsupported future versions, malformed relationships, and truncated
   archives with an actionable message.
3. Create an automatic safety backup of the current database.
4. Restore into a separate temporary database.
5. Run migrations and integrity checks there.
6. Replace the active database atomically only after validation succeeds.
7. Keep the safety backup available and report its location.

Restore v1 replaces the current dataset; it does not attempt an ambiguous merge.
Failures detected before replacement leave the active database unchanged. If
the process stops or final durability confirmation fails after atomic
replacement has begun, the active database may already contain the restored
data; Dayflow reports that uncertainty and retains any safety backup that was
actually created. A safety-backup path is not presented as recoverable unless
the artifact exists.

## Export Contract

- A full JSON export remains stable, versioned, and documented.
- CSV exports may cover Tasks and Activities for analysis.
- Exports include enough identifiers to relate records but do not claim to be
  directly restorable unless they satisfy the Backup Contract.
- Export failures never produce a file presented as complete.

## Error and Recovery UX

- Use plain descriptions such as “Your note was not saved. Your draft is still
  here.”
- Do not report success optimistically before persistence.
- Background retry may occur for transient failures, but it must be bounded.
- Silent retries announce only final failure or recovery.
- A retry action operates on the preserved payload, not a reconstructed subset.
- Destructive restore and replace actions require explicit confirmation and show
  their recoverability.

## Acceptance Criteria

1. Force a 500 response while adding a Task, Note, or Material: all entered
   fields remain, the failure is visible, and retry creates one record.
2. Return malformed success JSON: the client keeps the draft and treats the
   mutation as failed.
3. Submit negative minutes, invalid enums, invalid dates, missing relationships,
   and conflicting Project attribution: each returns a typed 4xx response and
   writes nothing.
4. Repeat an idempotent create request: exactly one record exists.
5. Open Journal with more than 100 Notes and 100 Materials: every record is
   reachable through stable pagination.
6. Open bootstrap and Review on a day with no Diary entry: the database remains
   unchanged.
7. Upgrade a copy of every supported prior schema to the current schema without
   losing records or relationships.
8. Create a backup, delete the working copy in a disposable test environment,
   restore the backup, and obtain matching per-table counts and relationship
   checks.
9. Attempt to restore a malformed archive: the active database remains unchanged
   and a safety backup is retained.
10. Run the complete automated suite without accessing the user's development
    database.

## Required Test Coverage

- Unit tests for shared parsers and response decoders.
- API contract tests for every mutation's validation and error shape.
- Failure-injection browser tests for draft preservation and retry.
- Pagination tests using datasets larger than one page.
- Migration tests from checked-in prior schema fixtures.
- Backup round-trip and corrupted-backup tests.
- Tests proving GET/bootstrap requests are side-effect free.

## Release Gate

This specification is complete when:

- all create workflows preserve drafts through failure;
- the API validation matrix is enforced consistently;
- canonical Journal history is fully reachable;
- checked-in migrations replace manual schema pushing for upgrades;
- backup and restore pass a destructive disposable round-trip test;
- the README documents upgrade, backup, and restore commands;
- no automated test can address the user's active database.

## Implementation Record

Implemented July 27, 2026.

- Task, Activity, Note, Material, Project, Phase, and Focus Session creates use
  stable client mutation identifiers backed by transactional durable receipts.
  Diary uses its unique local date as a natural idempotency key.
- Create forms retain drafts until a validated canonical response arrives,
  distinguish persistence from a later refresh failure, and expose retry and
  recovery state.
- Shared parsers enforce bounded text, path identifiers, dates, enums, numeric
  values, URLs, and relationship consistency with typed 400, 404, and 409
  responses. Unit contract coverage exercises every mutating route.
- Notes and References expose stable cursor pagination, snapshot-consistent
  totals, loading/retry/end states, and complete histories larger than 100
  records.
- The versioned JSON agent export is complete rather than dashboard-windowed.
- Checked-in migrations cover every current schema change and are tested from
  all supported prior schema fixtures.
- `db:backup` writes an atomic, checksummed SQLite snapshot artifact.
  `db:restore` validates checksums, record counts, relationships, the exact
  application schema, and migration checksums before replacement; it restores a
  deleted working database or retains a safety backup when replacing one.
- A local **Data & backups** dialog creates, downloads, and inspects managed
  artifacts. Restore selection requires explicit confirmation and is applied
  during the next Dayflow startup, before the first Prisma request opens
  SQLite; the selected checksum is revalidated and any safety backup actually
  created before replacement is retained and reported.
- Disposable integration coverage exercises deleted-database recovery,
  existing-database replacement, staged-checksum changes, interrupted applying
  state, real Next startup restoration, and corrupt-artifact rejection.
  Browser tests cover managed backup creation and download, confirmation,
  cancellation, and scheduling failure alongside draft preservation,
  malformed-success rejection, idempotent replay, and complete Journal
  pagination without touching the active database or enabling live restore.
