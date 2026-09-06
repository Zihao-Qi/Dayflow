import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectDatabaseBackup } from "../src/modules/data-ops/services/sqlite-backup-engine";

const repositoryRoot = process.cwd();
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "dayflow-migration-test-")
);
const freshDatabase = join(temporaryDirectory, "fresh.db");
const emptyDatabase = join(temporaryDirectory, "empty.db");
const legacyDatabase = join(temporaryDirectory, "legacy.db");
const currentSetupDatabase = join(temporaryDirectory, "current-setup.db");
const preProjectDatabase = join(temporaryDirectory, "pre-project.db");
const earliestDatabase = join(temporaryDirectory, "earliest.db");
const projectEraDatabase = join(temporaryDirectory, "project-era.db");
const focusEraDatabase = join(temporaryDirectory, "focus-era.db");
const existingSetupDatabase = join(temporaryDirectory, "existing-setup.db");
const seededSetupDatabase = join(temporaryDirectory, "seeded-setup.db");
const corruptDatabase = join(temporaryDirectory, "corrupt.db");
const unrelatedDatabase = join(temporaryDirectory, "unrelated.db");
const symbolicLinkDatabase = join(temporaryDirectory, "symbolic-link.db");
const brokenSymbolicLinkDatabase = join(
  temporaryDirectory,
  "broken-symbolic-link.db"
);
const unsupportedDatabase = join(temporaryDirectory, "unsupported.db");
const futureColumnDatabase = join(
  temporaryDirectory,
  "future-column.db"
);
const futureMigrationDatabase = join(
  temporaryDirectory,
  "future-migration.db"
);
const missingIndexDatabase = join(
  temporaryDirectory,
  "missing-index.db"
);
const missingForeignKeyDatabase = join(
  temporaryDirectory,
  "missing-foreign-key.db"
);
const missingLegacyIndexDatabase = join(
  temporaryDirectory,
  "missing-legacy-index.db"
);
const unsupportedPreProjectColumnsDatabase = join(
  temporaryDirectory,
  "unsupported-pre-project-columns.db"
);
const generatedColumnDatabase = join(
  temporaryDirectory,
  "generated-column.db"
);
const outOfOrderHistoryDatabase = join(
  temporaryDirectory,
  "out-of-order-history.db"
);
const orphanedPreProjectRelationshipDatabase = join(
  temporaryDirectory,
  "orphaned-pre-project-relationship.db"
);
const generatedKnownColumnDatabase = join(
  temporaryDirectory,
  "generated-known-column.db"
);
const duplicateLegacyDiaryDateDatabase = join(
  temporaryDirectory,
  "duplicate-legacy-diary-date.db"
);
const nullLegacyTaskTitleDatabase = join(
  temporaryDirectory,
  "null-legacy-task-title.db"
);

try {
  runMigration(freshDatabase);
  assert.equal(query(freshDatabase, "PRAGMA integrity_check;"), "ok");
  assert.equal(appliedMigrationCount(freshDatabase), "5");
  assertReviewSchema(freshDatabase);
  assert.deepEqual(migrationSafetyBackups(), []);

  runMigration(freshDatabase);
  assert.equal(migrationSafetyBackups().length, 1);

  execFileSync("sqlite3", [emptyDatabase, "VACUUM;"]);
  const artifactsBeforeEmptyMigration = migrationSafetyBackups();
  runMigration(emptyDatabase);
  assert.deepEqual(
    migrationSafetyBackups(),
    artifactsBeforeEmptyMigration
  );

  const beforePathOnlyBypassHash = fileSha256(freshDatabase);
  const artifactsBeforePathOnlyBypass = migrationSafetyBackups();
  const pathOnlyBypass = runMigrationArgumentsCaptured(
    freshDatabase,
    ["--disposable-restore-copy", freshDatabase]
  );
  assert.notEqual(pathOnlyBypass.status, 0);
  assert.match(
    pathOnlyBypass.stderr,
    /migration helper received invalid arguments/i
  );
  assert.equal(fileSha256(freshDatabase), beforePathOnlyBypassHash);
  assert.deepEqual(
    migrationSafetyBackups(),
    artifactsBeforePathOnlyBypass
  );

  execFileSync("sqlite3", [legacyDatabase], {
    input: readFileSync(
      join(
        repositoryRoot,
        "prisma",
        "migrations",
        "20260723000000_initial",
        "migration.sql"
      ),
      "utf8"
    )
  });
  execFileSync("sqlite3", [
    legacyDatabase,
    `INSERT INTO "FocusSession" (
       "id",
       "kind",
       "plannedMinutes",
       "actualMinutes",
       "label",
       "startedAt",
       "status",
       "completedAt",
       "needsRecord",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-focus',
       'FOCUS',
       25,
       25,
       'Legacy evidence',
       1785000000000,
       'COMPLETED',
       1785001500000,
       1,
       1785000000000,
       1785001500000
     );`
  ]);
  execFileSync("sqlite3", [
    legacyDatabase,
    `INSERT INTO "Task" (
       "id",
       "title",
       "date",
       "status",
       "actualMinutes",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-actual-task',
       'Legacy recorded task time',
       1785000000000,
       'DONE',
       45,
       1785000000000,
       1785001500000
     );`
  ]);
  execFileSync("sqlite3", [
    legacyDatabase,
    `INSERT INTO "FocusSession" (
       "id",
       "kind",
       "plannedMinutes",
       "actualMinutes",
       "label",
       "startedAt",
       "status",
       "completedAt",
       "needsRecord",
       "completionNote",
       "completionCategory",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-recorded-focus',
       'FOCUS',
       25,
       25,
       'Recorded legacy evidence',
       1785100000000,
       'COMPLETED',
       1785101500000,
       0,
       'Expected focus note',
       'Deep Work',
       1785100000000,
       1785101500000
     );
     INSERT INTO "ActivityEntry" (
       "id",
       "startedAt",
       "durationMinutes",
       "category",
       "note",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'manual-collision',
       1785100000000,
       25,
       'Learning',
       'Independent manual note',
       1785100000000,
       1785100000000
     );
     INSERT INTO "FocusSession" (
       "id",
       "kind",
       "plannedMinutes",
       "actualMinutes",
       "label",
       "startedAt",
       "status",
       "completedAt",
       "needsRecord",
       "completionNote",
       "completionCategory",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-exact-collision',
       'FOCUS',
       30,
       30,
       'Exact collision',
       1785200000000,
       'COMPLETED',
       1785201800000,
       0,
       'Exact manual note',
       'Deep Work',
       1785200000000,
       1785201800000
     );
     INSERT INTO "ActivityEntry" (
       "id",
       "startedAt",
       "durationMinutes",
       "category",
       "note",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'exact-manual-collision',
       1785200000000,
       30,
       'Deep Work',
       'Exact manual note',
       1785200000000,
       1785200000000
     );
     INSERT INTO "FocusSession" (
       "id",
       "kind",
       "plannedMinutes",
       "actualMinutes",
       "label",
       "startedAt",
       "status",
       "completedAt",
       "needsRecord",
       "recordedAt",
       "completionNote",
       "completionCategory",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-auto-recorded-focus',
       'FOCUS',
       25,
       25,
       'Auto-recorded focus',
       1785400000000,
       'COMPLETED',
       1785401500000,
       0,
       1785401510000,
       'Auto-generated focus note',
       'Deep Work',
       1785400000000,
       1785401510000
     );
     INSERT INTO "ActivityEntry" (
       "id",
       "startedAt",
       "durationMinutes",
       "category",
       "note",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-auto-recorded-activity',
       1785400000000,
       25,
       'Deep Work',
       'Auto-generated focus note',
       1785401510000,
       1785401510000
     );`
  ]);
  execFileSync("sqlite3", [
    legacyDatabase,
    `INSERT INTO "Task" (
       "id",
       "title",
       "date",
       "status",
       "actualMinutes",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'legacy-partial-task',
       'Legacy partially represented task time',
       1785300000000,
       'DONE',
       45,
       1785300000000,
       1785302700000
     );
     INSERT INTO "ActivityEntry" (
       "id",
       "startedAt",
       "durationMinutes",
       "category",
       "note",
       "taskId",
       "createdAt",
       "updatedAt"
     ) VALUES (
       'unrelated-partial-activity',
       1785300000000,
       5,
       'Admin',
       'A separately captured activity',
       'legacy-partial-task',
       1785300000000,
       1785300300000
     );`
  ]);

  runMigration(legacyDatabase);
  assert.equal(query(legacyDatabase, "PRAGMA integrity_check;"), "ok");
  assert.equal(appliedMigrationCount(legacyDatabase), "5");
  assertReviewSchema(legacyDatabase);
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "origin" || '|' || "durationMinutes" || '|' || "focusSessionId"
       FROM "ActivityEntry"
       WHERE "focusSessionId" = 'legacy-focus';`
    ),
    "FOCUS|25|legacy-focus"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "origin" || '|' || COALESCE("focusSessionId", 'unlinked')
       FROM "ActivityEntry"
       WHERE "id" = 'manual-collision';`
    ),
    "MANUAL|unlinked"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT COUNT(*) FROM "ActivityEntry"
       WHERE "focusSessionId" = 'legacy-recorded-focus'
         AND "origin" = 'FOCUS';`
    ),
    "1"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT COUNT(*) FROM "ActivityEntry"
       WHERE "note" = 'Auto-generated focus note';`
    ),
    "1"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "origin" || '|' || "focusSessionId"
       FROM "ActivityEntry"
       WHERE "id" = 'legacy-auto-recorded-activity';`
    ),
    "FOCUS|legacy-auto-recorded-focus"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "origin" || '|' || COALESCE("focusSessionId", 'unlinked')
       FROM "ActivityEntry"
       WHERE "id" = 'exact-manual-collision';`
    ),
    "MANUAL|unlinked"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT COUNT(*) FROM "ActivityEntry"
       WHERE "focusSessionId" = 'legacy-exact-collision'
         AND "origin" = 'FOCUS';`
    ),
    "1"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "durationMinutes" || '|' || "origin" || '|' || "taskId"
       FROM "ActivityEntry"
       WHERE "id" = 'legacy-task-legacy-actual-task';`
    ),
    "45|MANUAL|legacy-actual-task"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT "durationMinutes" || '|' || "origin" || '|' || "taskId"
       FROM "ActivityEntry"
       WHERE "id" = 'legacy-task-legacy-partial-task';`
    ),
    "40|MANUAL|legacy-partial-task"
  );
  assert.equal(
    query(
      legacyDatabase,
      `SELECT SUM("durationMinutes") FROM "ActivityEntry"
       WHERE "taskId" = 'legacy-partial-task';`
    ),
    "45"
  );

  runMigration(legacyDatabase);
  assert.equal(appliedMigrationCount(legacyDatabase), "5");
  assertReviewSchema(legacyDatabase);
  assert.equal(
    query(
      legacyDatabase,
      `SELECT COUNT(*) FROM "ActivityEntry"
       WHERE "focusSessionId" = 'legacy-focus';`
    ),
    "1"
  );

  execFileSync("sqlite3", [currentSetupDatabase], {
    input: readFileSync(join(repositoryRoot, "prisma", "init.sql"), "utf8")
  });
  runMigration(currentSetupDatabase);
  assert.equal(query(currentSetupDatabase, "PRAGMA integrity_check;"), "ok");
  assert.equal(appliedMigrationCount(currentSetupDatabase), "5");
  assertReviewSchema(currentSetupDatabase);

  writeFileSync(corruptDatabase, "not a SQLite database");
  assertRejectedBeforeMutation(corruptDatabase);

  execFileSync("sqlite3", [
    unrelatedDatabase,
    `CREATE TABLE "Task" ("id" TEXT PRIMARY KEY);
     CREATE TABLE "Note" ("id" TEXT PRIMARY KEY);
     CREATE TABLE "DiaryEntry" ("id" TEXT PRIMARY KEY);
     CREATE TABLE "Material" ("id" TEXT PRIMARY KEY);
     CREATE TABLE "TimeBlock" ("id" TEXT PRIMARY KEY);`
  ]);
  assertRejectedBeforeMutation(unrelatedDatabase);

  symlinkSync(currentSetupDatabase, symbolicLinkDatabase);
  assertRejectedBeforeMutation(symbolicLinkDatabase);

  symlinkSync(
    join(temporaryDirectory, "missing-symbolic-link-target.db"),
    brokenSymbolicLinkDatabase
  );
  assertRejectedBeforeMutation(brokenSymbolicLinkDatabase);

  execFileSync("sqlite3", [unsupportedDatabase], {
    input: historicalSchema("5b64c3f")
  });
  execFileSync("sqlite3", [
    unsupportedDatabase,
    `ALTER TABLE "Task"
       ADD COLUMN "focusQueuePosition" INTEGER;`
  ]);
  assertRejectedBeforeMutation(unsupportedDatabase);

  execFileSync("sqlite3", [unsupportedPreProjectColumnsDatabase], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    unsupportedPreProjectColumnsDatabase,
    `ALTER TABLE "Task" ADD COLUMN "projectId" TEXT;
     UPDATE "Task" SET "projectId" = 'orphan-project';`
  ]);
  const unsupportedPreProjectColumnsRejection =
    assertRejectedBeforeMutation(
      unsupportedPreProjectColumnsDatabase
    );
  assert.match(
    unsupportedPreProjectColumnsRejection.stderr,
    /Project relationship columns are present without the Project table/
  );

  copyFileSync(freshDatabase, generatedColumnDatabase);
  execFileSync("sqlite3", [
    generatedColumnDatabase,
    `ALTER TABLE "Task"
       ADD COLUMN "futureGenerated" TEXT
       GENERATED ALWAYS AS ("title" || '!') VIRTUAL;`
  ]);
  const generatedColumnRejection =
    assertRejectedBeforeMutation(generatedColumnDatabase);
  assert.match(
    generatedColumnRejection.stderr,
    /unexpected column Task\.futureGenerated/
  );

  execFileSync("sqlite3", [generatedKnownColumnDatabase], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    generatedKnownColumnDatabase,
    `ALTER TABLE "Task"
       ADD COLUMN "projectId" TEXT
       GENERATED ALWAYS AS ('future-project') VIRTUAL;`
  ]);
  const generatedKnownColumnRejection =
    assertRejectedBeforeMutation(generatedKnownColumnDatabase);
  assert.match(
    generatedKnownColumnRejection.stderr,
    /unexpected column Task\.projectId.*generated/
  );

  copyFileSync(freshDatabase, outOfOrderHistoryDatabase);
  execFileSync("sqlite3", [
    outOfOrderHistoryDatabase,
    `UPDATE "_prisma_migrations"
        SET "started_at" = CASE "migration_name"
          WHEN '20260723000000_initial' THEN 200
          WHEN '20260727000000_evidence_integrity' THEN 100
          ELSE "started_at"
        END;`
  ]);
  const outOfOrderHistoryRejection =
    assertRejectedBeforeMutation(outOfOrderHistoryDatabase);
  assert.match(
    outOfOrderHistoryRejection.stderr,
    /applied Prisma migrations are not a supported prefix/
  );

  execFileSync("sqlite3", [
    orphanedPreProjectRelationshipDatabase
  ], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    orphanedPreProjectRelationshipDatabase,
    `PRAGMA foreign_keys=OFF;
     BEGIN IMMEDIATE;
     CREATE TABLE "new_Note" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "content" TEXT NOT NULL,
       "tags" TEXT NOT NULL DEFAULT '[]',
       "date" DATETIME NOT NULL,
       "taskId" TEXT,
       "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" DATETIME NOT NULL
     );
     INSERT INTO "new_Note" (
       "id", "content", "tags", "date", "taskId",
       "createdAt", "updatedAt"
     )
     SELECT
       "id", "content", "tags", "date", "taskId",
       "createdAt", "updatedAt"
     FROM "Note";
     DROP TABLE "Note";
     ALTER TABLE "new_Note" RENAME TO "Note";
     INSERT INTO "Note" (
       "id", "content", "date", "taskId", "createdAt", "updatedAt"
     ) VALUES (
       'orphan-note', 'Do not silently discard this relationship',
       1785000000000, 'missing-task', 1785000000000, 1785000000000
     );
     COMMIT;
     PRAGMA foreign_keys=ON;`
  ]);
  const orphanedRelationshipRejection =
    assertRejectedBeforeMutation(
      orphanedPreProjectRelationshipDatabase
    );
  assert.match(
    orphanedRelationshipRejection.stderr,
    /Note\.taskId relationship validation failed/
  );

  execFileSync("sqlite3", [duplicateLegacyDiaryDateDatabase], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    duplicateLegacyDiaryDateDatabase,
    `DROP INDEX "DiaryEntry_date_key";
     INSERT INTO "DiaryEntry" (
       "id", "date", "createdAt", "updatedAt"
     ) VALUES
       ('duplicate-diary-1', 1785000000000, 1785000000000, 1785000000000),
       ('duplicate-diary-2', 1785000000000, 1785000000000, 1785000000000);`
  ]);
  const duplicateLegacyDiaryRejection =
    assertRejectedBeforeMutation(
      duplicateLegacyDiaryDateDatabase
    );
  assert.match(
    duplicateLegacyDiaryRejection.stderr,
    /pre-Project upgrade preflight failed/
  );

  execFileSync("sqlite3", [nullLegacyTaskTitleDatabase], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    nullLegacyTaskTitleDatabase,
    `PRAGMA foreign_keys=OFF;
     BEGIN IMMEDIATE;
     CREATE TABLE "new_Task" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "title" TEXT,
       "date" DATETIME NOT NULL,
       "status" TEXT NOT NULL DEFAULT 'TODO',
       "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
       "urgentScore" INTEGER NOT NULL DEFAULT 2,
       "importanceScore" INTEGER NOT NULL DEFAULT 3,
       "deadline" DATETIME,
       "estimateMinutes" INTEGER NOT NULL DEFAULT 30,
       "actualMinutes" INTEGER NOT NULL DEFAULT 0,
       "sortOrder" INTEGER NOT NULL DEFAULT 0,
       "completedAt" DATETIME,
       "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" DATETIME NOT NULL
     );
     INSERT INTO "new_Task"
     SELECT * FROM "Task";
     DROP TABLE "Task";
     ALTER TABLE "new_Task" RENAME TO "Task";
     INSERT INTO "Task" (
       "id", "title", "date", "createdAt", "updatedAt"
     ) VALUES (
       'null-title-task', NULL, 1785000000000,
       1785000000000, 1785000000000
     );
     COMMIT;
     PRAGMA foreign_keys=ON;`
  ]);
  const nullLegacyTaskTitleRejection =
    assertRejectedBeforeMutation(nullLegacyTaskTitleDatabase);
  assert.match(
    nullLegacyTaskTitleRejection.stderr,
    /pre-Project upgrade preflight failed/
  );

  copyFileSync(freshDatabase, futureColumnDatabase);
  execFileSync("sqlite3", [
    futureColumnDatabase,
    `ALTER TABLE "Task" ADD COLUMN "futureOnly" TEXT;`
  ]);
  assertRejectedBeforeMutation(futureColumnDatabase);

  copyFileSync(freshDatabase, futureMigrationDatabase);
  execFileSync("sqlite3", [
    futureMigrationDatabase,
    `INSERT INTO "_prisma_migrations" (
       "id", "checksum", "finished_at", "migration_name",
       "logs", "rolled_back_at", "started_at", "applied_steps_count"
     ) VALUES (
       'future-migration', '${"0".repeat(64)}', 1785000000000,
       '20990101000000_future', NULL, NULL, 1785000000000, 1
     );`
  ]);
  assertRejectedBeforeMutation(futureMigrationDatabase);

  copyFileSync(freshDatabase, missingIndexDatabase);
  execFileSync("sqlite3", [
    missingIndexDatabase,
    `DROP INDEX "Task_date_idx";`
  ]);
  const missingIndexRejection =
    assertRejectedBeforeMutation(missingIndexDatabase);
  assert.match(
    missingIndexRejection.stderr,
    /Task has unexpected indexes/
  );

  copyFileSync(freshDatabase, missingForeignKeyDatabase);
  execFileSync("sqlite3", [
    missingForeignKeyDatabase,
    `PRAGMA foreign_keys=OFF;
     BEGIN IMMEDIATE;
     ALTER TABLE "TimeBlock" RENAME TO "legacy_TimeBlock";
     CREATE TABLE "TimeBlock" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "date" DATETIME NOT NULL,
       "startTime" TEXT NOT NULL,
       "endTime" TEXT NOT NULL,
       "title" TEXT NOT NULL,
       "taskId" TEXT,
       "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" DATETIME NOT NULL
     );
     INSERT INTO "TimeBlock" (
       "id", "date", "startTime", "endTime", "title", "taskId",
       "createdAt", "updatedAt"
     )
     SELECT
       "id", "date", "startTime", "endTime", "title", "taskId",
       "createdAt", "updatedAt"
     FROM "legacy_TimeBlock";
     DROP TABLE "legacy_TimeBlock";
     COMMIT;
     PRAGMA foreign_keys=ON;`
  ]);
  const missingForeignKeyRejection =
    assertRejectedBeforeMutation(missingForeignKeyDatabase);
  assert.match(
    missingForeignKeyRejection.stderr,
    /TimeBlock has unexpected foreignKeys/
  );

  execFileSync("sqlite3", [missingLegacyIndexDatabase], {
    input: historicalSchema("5b64c3f")
  });
  execFileSync("sqlite3", [
    missingLegacyIndexDatabase,
    `DROP INDEX "Task_date_idx";`
  ]);
  const missingLegacyIndexRejection =
    assertRejectedBeforeMutation(missingLegacyIndexDatabase);
  assert.match(
    missingLegacyIndexRejection.stderr,
    /Task has unexpected indexes/
  );

  const backupFailureDirectory = join(
    temporaryDirectory,
    "backup-failure"
  );
  const backupFailureDatabase = join(
    backupFailureDirectory,
    "active.db"
  );
  mkdirSync(backupFailureDirectory);
  copyFileSync(freshDatabase, backupFailureDatabase);
  const blockedBackupDirectory = join(
    backupFailureDirectory,
    "backups"
  );
  writeFileSync(blockedBackupDirectory, "blocked");
  const beforeBackupFailure = fileSha256(backupFailureDatabase);
  const backupFailure = runMigrationCaptured(backupFailureDatabase);
  assert.notEqual(backupFailure.status, 0);
  assert.match(backupFailure.stderr, /Dayflow migration failed:/);
  assert.doesNotMatch(
    backupFailure.stderr,
    /database may be partially changed/i
  );
  assert.equal(fileSha256(backupFailureDatabase), beforeBackupFailure);
  assert.equal(readFileSync(blockedBackupDirectory, "utf8"), "blocked");

  const postBackupFailureDirectory = join(
    temporaryDirectory,
    "post-backup-failure"
  );
  const postBackupFailureDatabase = join(
    postBackupFailureDirectory,
    "active.db"
  );
  mkdirSync(postBackupFailureDirectory);
  copyFileSync(freshDatabase, postBackupFailureDatabase);
  execFileSync("sqlite3", [
    postBackupFailureDatabase,
    `INSERT INTO "Task" (
       "id", "title", "createdAt", "updatedAt"
     ) VALUES (
       'recovery-sentinel', 'Recover the protected task',
       1785000000000, 1785000000000
     );`
  ]);
  const postBackupFailure = runMigrationCaptured(
    postBackupFailureDatabase,
    {
      PRISMA_SCHEMA_ENGINE_BINARY: join(
        postBackupFailureDirectory,
        "missing-schema-engine"
      )
    }
  );
  assert.notEqual(postBackupFailure.status, 0);
  const retainedArtifacts = migrationSafetyBackupsIn(
    postBackupFailureDirectory
  );
  assert.equal(retainedArtifacts.length, 1);
  const retainedArtifact = join(
    postBackupFailureDirectory,
    "backups",
    retainedArtifacts[0]
  );
  const retainedInspection = inspectDatabaseBackup(retainedArtifact);
  assert.equal(retainedInspection.checksumVerified, true);
  assert.match(postBackupFailure.stdout, /Migration safety backup verified/);
  assert.match(
    postBackupFailure.stdout,
    new RegExp(escapeRegExp(retainedArtifact))
  );
  assert.match(
    postBackupFailure.stdout,
    new RegExp(retainedInspection.manifest.payloadSha256)
  );
  assert.match(
    postBackupFailure.stdout,
    new RegExp(retainedInspection.manifest.schemaVersion)
  );
  assert.match(postBackupFailure.stdout, /Task: 1/);
  assert.match(
    postBackupFailure.stderr,
    new RegExp(`Safety backup retained: ${escapeRegExp(retainedArtifact)}`)
  );
  assert.match(
    postBackupFailure.stderr,
    /database may be partially changed; no automatic rollback was attempted/i
  );
  assert.match(
    postBackupFailure.stderr,
    new RegExp(
      `npm run db:restore -- --from .*${escapeRegExp(
        retainedArtifacts[0]
      )}.* --confirm-replace`
    )
  );
  const recoveredPostBackupDatabase = join(
    postBackupFailureDirectory,
    "recovered.db"
  );
  const recovery = runRestoreCaptured(
    recoveredPostBackupDatabase,
    retainedArtifact
  );
  assert.equal(
    recovery.status,
    0,
    `Recovery failed\nstdout:\n${recovery.stdout}\nstderr:\n${recovery.stderr}`
  );
  assert.equal(
    query(
      recoveredPostBackupDatabase,
      `SELECT "title" FROM "Task"
        WHERE "id" = 'recovery-sentinel';`
    ),
    "Recover the protected task"
  );
  assert.deepEqual(
    migrationSafetyBackupsIn(postBackupFailureDirectory),
    retainedArtifacts
  );

  execFileSync("sqlite3", [preProjectDatabase], {
    input: `
      CREATE TABLE "Task" (
        "id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL,
        "date" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'TODO',
        "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
        "urgentScore" INTEGER NOT NULL DEFAULT 2,
        "importanceScore" INTEGER NOT NULL DEFAULT 3,
        "deadline" DATETIME, "estimateMinutes" INTEGER NOT NULL DEFAULT 30,
        "actualMinutes" INTEGER NOT NULL DEFAULT 0,
        "sortOrder" INTEGER NOT NULL DEFAULT 0, "completedAt" DATETIME,
        "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "Note" (
        "id" TEXT NOT NULL PRIMARY KEY, "content" TEXT NOT NULL,
        "tags" TEXT NOT NULL DEFAULT '[]', "date" DATETIME NOT NULL,
        "taskId" TEXT, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "DiaryEntry" (
        "id" TEXT NOT NULL PRIMARY KEY, "date" DATETIME NOT NULL,
        "content" TEXT NOT NULL DEFAULT '', "reflection" TEXT NOT NULL DEFAULT '',
        "mood" INTEGER NOT NULL DEFAULT 3, "energy" INTEGER NOT NULL DEFAULT 3,
        "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
      );
      CREATE UNIQUE INDEX "DiaryEntry_date_key" ON "DiaryEntry"("date");
      CREATE TABLE "Material" (
        "id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "url" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'website', "notes" TEXT NOT NULL DEFAULT '',
        "taskId" TEXT, "noteId" TEXT, "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "TimeBlock" (
        "id" TEXT NOT NULL PRIMARY KEY, "date" DATETIME NOT NULL,
        "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "title" TEXT NOT NULL,
        "taskId" TEXT, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "ActivityEntry" (
        "id" TEXT NOT NULL PRIMARY KEY, "startedAt" DATETIME NOT NULL,
        "durationMinutes" INTEGER NOT NULL, "category" TEXT NOT NULL,
        "note" TEXT NOT NULL, "taskId" TEXT, "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO "Task" (
        "id", "title", "date", "createdAt", "updatedAt"
      ) VALUES (
        'pre-project-task', 'Preserve pre-Project task', 1785000000000,
        1785000000000, 1785000000000
      );
      INSERT INTO "ActivityEntry" (
        "id", "startedAt", "durationMinutes", "category", "note", "taskId",
        "createdAt", "updatedAt"
      ) VALUES (
        'pre-project-activity', 1785000000000, 20, 'Learning',
        'Preserve pre-Project activity', 'pre-project-task',
        1785000000000, 1785000000000
      );
    `
  });
  const expectedPreProjectSnapshot =
    canonicalDatabaseSnapshot(preProjectDatabase);
  const preProjectSafetyBackup =
    runMigrationWithSafety(preProjectDatabase);
  assert.deepEqual(
    backupPayloadSnapshot(
      preProjectSafetyBackup,
      join(temporaryDirectory, "pre-project-artifact.db")
    ),
    expectedPreProjectSnapshot
  );
  const preProjectInspection = inspectDatabaseBackup(
    preProjectSafetyBackup
  );
  assert.equal(preProjectInspection.checksumVerified, true);
  assert.equal(
    preProjectInspection.manifest.schemaVersion,
    "legacy-unversioned"
  );
  assert.equal(preProjectInspection.manifest.recordCounts.Task, 1);
  assert.equal(
    preProjectInspection.manifest.recordCounts.ActivityEntry,
    1
  );
  assert.equal(appliedMigrationCount(preProjectDatabase), "5");
  assertReviewSchema(preProjectDatabase);
  assert.equal(
    query(
      preProjectDatabase,
      `SELECT "title" FROM "Task" WHERE "id" = 'pre-project-task';`
    ),
    "Preserve pre-Project task"
  );
  assert.equal(
    query(
      preProjectDatabase,
      `SELECT "note" FROM "ActivityEntry"
       WHERE "id" = 'pre-project-activity';`
    ),
    "Preserve pre-Project activity"
  );
  assert.equal(
    query(
      preProjectDatabase,
      `SELECT "notnull" FROM pragma_table_info('Task') WHERE "name" = 'date';`
    ),
    "0"
  );
  const restoredPreProjectDatabase = join(
    temporaryDirectory,
    "restored-pre-project.db"
  );
  const artifactsBeforePreProjectRestore =
    migrationSafetyBackups();
  const preProjectRestore = runRestoreCaptured(
    restoredPreProjectDatabase,
    preProjectSafetyBackup
  );
  assert.equal(
    preProjectRestore.status,
    0,
    `Pre-Project recovery failed\nstdout:\n${preProjectRestore.stdout}\nstderr:\n${preProjectRestore.stderr}`
  );
  assert.deepEqual(
    migrationSafetyBackups(),
    artifactsBeforePreProjectRestore
  );
  assertReviewSchema(restoredPreProjectDatabase);
  assert.equal(
    query(
      restoredPreProjectDatabase,
      `SELECT "title" FROM "Task"
        WHERE "id" = 'pre-project-task';`
    ),
    "Preserve pre-Project task"
  );
  assert.equal(
    query(
      restoredPreProjectDatabase,
      `SELECT "note" FROM "ActivityEntry"
        WHERE "id" = 'pre-project-activity';`
    ),
    "Preserve pre-Project activity"
  );

  execFileSync("sqlite3", [earliestDatabase], {
    input: historicalSchema("7c8fa9a")
  });
  execFileSync("sqlite3", [
    earliestDatabase,
    `INSERT INTO "Task" (
       "id", "title", "date", "createdAt", "updatedAt"
     ) VALUES (
       'earliest-task', 'Preserve earliest task', 1785000000000,
       1785000000000, 1785000000000
     );`
  ]);
  const expectedEarliestSnapshot =
    canonicalDatabaseSnapshot(earliestDatabase);
  const earliestSafetyBackup =
    runMigrationWithSafety(earliestDatabase);
  assert.deepEqual(
    backupPayloadSnapshot(
      earliestSafetyBackup,
      join(temporaryDirectory, "earliest-artifact.db")
    ),
    expectedEarliestSnapshot
  );
  assert.equal(appliedMigrationCount(earliestDatabase), "5");
  assertReviewSchema(earliestDatabase);
  assert.equal(
    query(
      earliestDatabase,
      `SELECT "title" FROM "Task" WHERE "id" = 'earliest-task';`
    ),
    "Preserve earliest task"
  );
  assert.equal(
    query(
      earliestDatabase,
      `SELECT COUNT(*) FROM pragma_table_info('ActivityEntry')
       WHERE "name" = 'focusSessionId';`
    ),
    "1"
  );
  const restoredEarliestDatabase = join(
    temporaryDirectory,
    "restored-earliest.db"
  );
  const artifactsBeforeHistoricalRestore = migrationSafetyBackups();
  const historicalRestore = runRestoreCaptured(
    restoredEarliestDatabase,
    earliestSafetyBackup
  );
  assert.equal(
    historicalRestore.status,
    0,
    `Historical recovery failed\nstdout:\n${historicalRestore.stdout}\nstderr:\n${historicalRestore.stderr}`
  );
  assert.deepEqual(
    migrationSafetyBackups(),
    artifactsBeforeHistoricalRestore
  );
  assert.equal(appliedMigrationCount(restoredEarliestDatabase), "5");
  assertReviewSchema(restoredEarliestDatabase);
  assert.equal(
    query(
      restoredEarliestDatabase,
      `SELECT "title" FROM "Task"
        WHERE "id" = 'earliest-task';`
    ),
    "Preserve earliest task"
  );

  execFileSync("sqlite3", [projectEraDatabase], {
    input: historicalSchema("5b64c3f")
  });
  execFileSync("sqlite3", [
    projectEraDatabase,
    `INSERT INTO "Task" (
       "id", "title", "createdAt", "updatedAt"
     ) VALUES (
       'project-era-task', 'Preserve Project-era task',
       1785000000000, 1785000000000
     );`
  ]);
  runMigration(projectEraDatabase);
  assert.equal(appliedMigrationCount(projectEraDatabase), "5");
  assertReviewSchema(projectEraDatabase);
  assert.equal(
    query(
      projectEraDatabase,
      `SELECT COUNT(*) FROM pragma_table_info('Task')
       WHERE "name" = 'focusQueuePosition';`
    ),
    "1"
  );
  assert.equal(
    query(
      projectEraDatabase,
      `SELECT COUNT(*) FROM pragma_table_info('FocusSession')
       WHERE "name" IN (
         'needsRecord', 'recordedAt', 'completionNote', 'completionCategory'
       );`
    ),
    "4"
  );
  assert.equal(
    query(
      projectEraDatabase,
      `SELECT "title" FROM "Task" WHERE "id" = 'project-era-task';`
    ),
    "Preserve Project-era task"
  );

  execFileSync("sqlite3", [focusEraDatabase], {
    input: historicalSchema("501aa95")
  });
  runMigration(focusEraDatabase);
  assert.equal(appliedMigrationCount(focusEraDatabase), "5");
  assertReviewSchema(focusEraDatabase);
  assert.equal(
    query(
      focusEraDatabase,
      `SELECT COUNT(*) FROM pragma_table_info('Task')
       WHERE "name" = 'focusQueuePosition';`
    ),
    "1"
  );

  runMigration(existingSetupDatabase);
  execFileSync("sqlite3", [
    existingSetupDatabase,
    `INSERT INTO "Task" (
       "id", "title", "createdAt", "updatedAt"
     ) VALUES (
       'existing-user-task', 'Do not erase this task',
       1785000000000, 1785000000000
     );`
  ]);
  runSetup(existingSetupDatabase);
  assert.equal(
    query(
      existingSetupDatabase,
      `SELECT "title" FROM "Task" WHERE "id" = 'existing-user-task';`
    ),
    "Do not erase this task"
  );

  runSetup(seededSetupDatabase);
  assert.notEqual(
    query(
      seededSetupDatabase,
      `SELECT COALESCE(SUM("durationMinutes"), 0)
       FROM "ActivityEntry"
       WHERE "attributedProjectId" IS NOT NULL;`
    ),
    "0"
  );

  // A seeded database must satisfy the Evidence Integrity invariants that
  // backup validation enforces. Seeding a Note with both a project-bearing
  // Task and its own projectId once made db:backup fail on every fresh setup.
  assertSeededDatabaseIsBackupable(seededSetupDatabase);

  console.log("Migration tests passed.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function runMigration(databasePath: string) {
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`
    },
    stdio: "inherit"
  });
}

function runMigrationCaptured(
  databasePath: string,
  environment: Record<string, string | undefined> = {}
) {
  return spawnSync("npm", ["run", "db:migrate"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...environment,
      DATABASE_URL: `file:${databasePath}`
    },
    encoding: "utf8"
  });
}

function runMigrationArgumentsCaptured(
  databasePath: string,
  args: string[]
) {
  return spawnSync(
    "npm",
    ["run", "db:migrate", "--", ...args],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`
      },
      encoding: "utf8"
    }
  );
}

function runRestoreCaptured(
  databasePath: string,
  backupPath: string
) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(repositoryRoot, "scripts", "restore-database.ts"),
      "--from",
      backupPath,
      "--confirm-replace"
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
}

function assertRejectedBeforeMutation(databasePath: string) {
  const beforeHash = existsSync(databasePath)
    ? fileSha256(databasePath)
    : null;
  const beforeArtifacts = migrationSafetyBackups();
  const result = runMigrationCaptured(databasePath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Dayflow migration failed:/);
  assert.doesNotMatch(
    result.stderr,
    /database may be partially changed/i
  );
  if (beforeHash) {
    assert.equal(fileSha256(databasePath), beforeHash);
  } else {
    assert.equal(existsSync(databasePath), false);
  }
  assert.deepEqual(migrationSafetyBackups(), beforeArtifacts);
  return result;
}

function assertSeededDatabaseIsBackupable(databasePath: string) {
  const backupDirectory = join(temporaryDirectory, "seeded-setup-backups");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(repositoryRoot, "scripts/backup-database.ts")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`,
        DAYFLOW_BACKUP_DIRECTORY: backupDirectory
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
  assert.equal(
    result.status,
    0,
    `A freshly seeded database must be backupable. ${result.stderr}`
  );
}

function runSetup(databasePath: string) {
  execFileSync("npm", ["run", "db:setup"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`
    },
    stdio: "inherit"
  });
}

function runMigrationWithSafety(databasePath: string) {
  const before = new Set(migrationSafetyBackups());
  runMigration(databasePath);
  const created = migrationSafetyBackups().filter(
    (name) => !before.has(name)
  );
  assert.equal(
    created.length,
    1,
    `Expected one migration safety artifact for ${databasePath}.`
  );
  return join(temporaryDirectory, "backups", created[0]);
}

function migrationSafetyBackups() {
  return migrationSafetyBackupsIn(temporaryDirectory);
}

function migrationSafetyBackupsIn(directory: string) {
  const backupDirectory = join(directory, "backups");
  return existsSync(backupDirectory)
    ? readdirSync(backupDirectory)
        .filter((name) =>
          name.startsWith("dayflow-safety-before-migration-")
        )
        .sort()
    : [];
}

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function backupPayloadSnapshot(
  backupPath: string,
  extractedDatabasePath: string
) {
  const inspection = inspectDatabaseBackup(backupPath);
  const artifact = readFileSync(backupPath);
  const magic = Buffer.from("DAYFLOW-BACKUP\n", "utf8");
  assert.equal(
    artifact.subarray(0, magic.length).equals(magic),
    true
  );
  const manifestLength = artifact.readUInt32BE(magic.length);
  const payloadOffset = magic.length + 4 + manifestLength;
  const payload = artifact.subarray(payloadOffset);
  assert.equal(payload.length, inspection.manifest.payloadBytes);
  writeFileSync(extractedDatabasePath, payload);
  assert.equal(
    fileSha256(extractedDatabasePath),
    inspection.manifest.payloadSha256
  );
  try {
    return canonicalDatabaseSnapshot(extractedDatabasePath);
  } finally {
    rmSync(extractedDatabasePath, { force: true });
  }
}

function canonicalDatabaseSnapshot(databasePath: string) {
  const schema = queryJson(
    databasePath,
    `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name;`
  );
  const tableNames = queryJson(
    databasePath,
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name;`
  ).map((row) => String(row.name));
  const records = Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      queryJson(
        databasePath,
        `SELECT *
           FROM "${tableName.replaceAll('"', '""')}"
          ORDER BY rowid;`
      )
    ])
  );
  return { schema, records };
}

function queryJson(
  databasePath: string,
  sql: string
): Array<Record<string, unknown>> {
  const output = execFileSync(
    "sqlite3",
    ["-readonly", "-json", databasePath, sql],
    { encoding: "utf8" }
  ).trim();
  return output ? JSON.parse(output) : [];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function historicalSchema(revision: string) {
  return execFileSync("git", ["show", `${revision}:prisma/init.sql`], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function appliedMigrationCount(databasePath: string) {
  return query(
    databasePath,
    `SELECT COUNT(*) FROM "_prisma_migrations"
     WHERE "finished_at" IS NOT NULL;`
  );
}

function assertReviewSchema(databasePath: string) {
  assert.equal(
    query(
      databasePath,
      `SELECT COUNT(*)
       FROM pragma_table_info('Review')
       WHERE name IN (
         'id', 'periodStart', 'periodEnd', 'narrative',
         'nextPeriodIntention', 'createdAt', 'updatedAt'
       );`
    ),
    "7"
  );
  assert.equal(
    query(
      databasePath,
      `SELECT "unique" || '|' || "partial"
       FROM pragma_index_list('Review')
       WHERE name = 'Review_periodStart_periodEnd_key';`
    ),
    "1|0"
  );
  assert.equal(
    query(
      databasePath,
      `SELECT group_concat(name, '|')
       FROM (
         SELECT name
         FROM pragma_index_info('Review_periodStart_periodEnd_key')
         ORDER BY seqno
       );`
    ),
    "periodStart|periodEnd"
  );
  assert.equal(
    query(
      databasePath,
      `SELECT COUNT(*)
       FROM pragma_index_list('Review')
       WHERE name = 'Review_periodEnd_idx';`
    ),
    "0"
  );
}

function query(databasePath: string, sql: string) {
  return execFileSync("sqlite3", [databasePath, sql], {
    encoding: "utf8"
  }).trim();
}
