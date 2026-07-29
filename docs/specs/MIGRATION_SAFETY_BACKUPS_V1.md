# Migration Safety Backups v1

Status: Implemented
Date: July 29, 2026

> **Reliability contract:**
> [Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md) remains
> authoritative for application reads, writes, and recovery behavior.

## Purpose

Dayflow keeps canonical personal data in one local SQLite database. A database
upgrade may baseline a historical schema, apply Prisma migrations, and
reconcile Evidence. Migration Safety Backups v1 ensures an existing recognized
Dayflow database has one verified recovery artifact before any of those
operations may mutate it.

The existing command remains the public interface:

```bash
npm run db:migrate
```

## Architecture

One deep database-migration module owns target classification, safety
establishment, historical baselining, Prisma deployment, Evidence
reconciliation, and recovery reporting.

Its interface has two deliberately named operations:

1. migrate the configured active database with safety enabled by default; and
2. migrate a validated disposable restore copy without creating a nested
   safety artifact.

There is no general boolean, environment setting, or public “skip safety”
mode. The migration command is a thin process adapter. Restore continues to
cross that process seam with an internal disposable-copy argument bundle so
the migration module can depend on the mature backup implementation without
creating a circular module dependency. The bundle names the absolute copy,
the retained source artifact, and its expected payload checksum. Before
suppressing a nested artifact, migration independently verifies the source
container and proves the copy's bytes exactly match that retained payload.

SQLite, the filesystem, Prisma, and child processes are local-substitutable
dependencies. Verification uses real disposable SQLite databases and files,
not mocks of Dayflow modules.

## Target Classification

Classification is read-only and happens before safety backup creation or
database mutation:

- A missing database, or a valid empty SQLite database with no application
  tables, is **fresh**.
- An existing database matching a supported current or historical Dayflow
  schema is **recognized**.
- A corrupt SQLite file, unrelated schema, symbolic-link active database, or
  unsupported partial Dayflow schema is rejected before migration.
- Unexpected future tables or regular/generated columns and unknown,
  incomplete, observably out-of-order, or checksum-mismatched Prisma migration
  history are unsupported.
- A versioned database must exactly match the logical columns, foreign keys,
  and indexes implied by its applied checked-in migration prefix. An
  unversioned Project-era database must exactly match its recognized legacy
  stage. Pre-Project schemas remain rebuild-normalized by the checked-in
  legacy upgrade.

Backup recognition includes the oldest Dayflow core schema still supported by
the migration helper. Later tables such as Activities, Focus Sessions,
Projects, Reviews, and Mutation Receipts are not required merely to preserve a
valid older database.

## Safety Backup Contract

Before the first mutation of a recognized active database, Dayflow:

1. creates a consistent SQLite snapshot through the existing backup
   implementation;
2. validates SQLite integrity, supported schema shape, relationships, record
   counts, manifest structure, and payload checksum;
3. atomically installs and durably syncs the artifact; and
4. reports the verified recovery facts.

The default artifact name is:

```text
backups/dayflow-safety-before-migration-<timestamp>-<id>.dayflow-backup
```

Reported facts include:

- absolute active database path;
- absolute safety artifact path;
- creation time;
- pre-migration schema version;
- payload SHA-256 checksum; and
- deterministic record counts.

The verified artifact is retained whether migration succeeds or fails. Dayflow
does not automatically prune, overwrite, restore, or roll back from it.

A fresh database does not receive a safety artifact because there is no prior
dataset to recover.

## Mutation Ordering

Only after safety is established may Dayflow:

1. initialize a fresh SQLite file when needed;
2. baseline or upgrade a supported historical schema;
3. run checked-in Prisma migrations; and
4. reconcile Evidence.

A current database still receives a safety backup. Prisma may have no pending
schema migration, but Evidence reconciliation remains a potentially mutating
maintenance operation.

## Failure Behavior

- If target classification or safety backup creation fails, migration does not
  begin and the active database remains byte-for-byte unchanged.
- If baselining, Prisma deployment, or Evidence reconciliation fails after the
  safety artifact is verified, the artifact remains valid and its path is
  reported.
- A post-backup failure states that the active database may be partially
  changed and gives the explicit `db:restore` recovery command.
- A fresh-database failure reports that no prior dataset required a safety
  artifact.
- No failure path claims automatic rollback.

## Restore Copies

Restore already keeps the selected source artifact, validates its checksum and
SQLite payload, and creates a separate safety backup of an existing active
database before replacement.

When restore migrates its extracted disposable copy:

- the exact disposable-copy migration operation is used;
- the retained source artifact and extracted payload are independently
  reverified before safety suppression;
- no nested migration-safety artifact is created;
- failure may change only the disposable copy; and
- the active database remains governed by the existing restore contract.

## Non-Goals

- Automatic rollback or restore after a migration failure.
- Scheduled or rolling backups, retention limits, pruning, or settings UI.
- A general protected-mutation framework for unrelated maintenance tasks.
- Changing the backup container format or restore confirmation contract.
- Schema changes, application routes, or product-workflow changes.
- Service workers, offline caching, client-side data stores, or synchronization.
- Migrating while the running application holds active database connections.

## Acceptance Criteria

1. A missing or valid empty database migrates without a safety artifact.
2. A recognized current database receives a verified artifact before any
   migration or reconciliation mutation.
3. Every supported historical schema can be backed up before migration.
4. A migration-safety artifact contains the exact pre-migration schema and
   records; the existing restore workflow migrates a verified copy to the
   current schema while preserving those records.
5. A forced backup-destination failure leaves the active database
   byte-for-byte unchanged and prevents migration.
6. A real failure after backup creation retains a valid artifact and reports
   recovery facts without claiming rollback.
7. A corrupt, unrelated, symbolic-link, or unsupported target is rejected
   before mutation.
8. Restore-copy migration creates no nested migration-safety artifact.
9. Existing backup, restore, migration, Evidence, production-build, and
   browser behavior remain green.

## Required Coverage

- CLI-level disposable-filesystem coverage for fresh, current, historical,
  invalid, pre-backup failure, and post-backup failure paths.
- Inspection and restore coverage proving exact pre-migration artifact
  contents.
- Restore integration coverage proving disposable-copy suppression.
- Output coverage for paths, checksum, schema version, counts, partial-change
  warning, and recovery command.
- The complete typecheck, unit, backup/integration, migration,
  production-build, and Chromium browser gates.

## Implementation Record

Implemented on July 29, 2026.

- `scripts/database-migration.ts` is the single migration policy module. It
  classifies the target read-only, establishes safety, baselines known legacy
  schemas, deploys Prisma migrations, reconciles Evidence, and preserves
  phase-specific failure facts.
- Existing recognized active databases receive an atomically installed,
  checksum-verified `migration-safety` artifact before mutation. Missing and
  valid empty databases are classified as fresh.
- Schema classification rejects corrupt, unrelated, symbolic-link, partial,
  future, history-skewed, and structurally altered targets before backup or
  mutation. Direct logical relationships are checked even when a legacy table
  did not declare its foreign key. Versioned and Project-era structural
  validation shares the same semantic column, foreign-key, and index descriptor
  used by restore.
- Restore uses a proof-bound disposable-copy entry point. It independently
  revalidates the retained container and exact payload bytes before suppressing
  a nested migration artifact.
- The pre-Project rebuild now normalizes `DiaryEntry` along with the other
  legacy tables, so retained historical artifacts restore to the exact current
  schema.
- The complete release gate passes: 137 unit tests, 14 backup/restore
  integration tests, the expanded real-SQLite migration matrix, the production
  build, and 103 Chromium browser tests.
