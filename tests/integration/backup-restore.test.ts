import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();

/**
 * The engine takes its instant from the caller, so a frozen clock must produce a
 * filename stem and a manifest createdAt that agree. Before mandatory injection
 * the restore path sampled `new Date()` twice — once for the safety backup's
 * filename and once for its manifest — so the two could straddle a second.
 */
test(
  "a frozen instant gives the safety backup one timestamp in both its name and its manifest",
  { timeout: 120_000 },
  async () => {
    const { createDatabaseBackup, restoreDatabaseBackup, inspectDatabaseBackup } =
      await import("../../src/modules/data-ops/services/sqlite-backup-engine");
    const directory = mkdtempSync(join(tmpdir(), "dayflow-shared-instant-"));
    const activeDatabase = join(directory, "active.db");
    const source = join(directory, "source.dayflow-backup");
    const frozen = new Date("2026-09-06T23:59:59.500Z");

    try {
      migrate(activeDatabase);
      createDatabaseBackup({
        databasePath: activeDatabase,
        outputPath: source,
        repositoryRoot,
        now: frozen
      });

      // No safetyBackupPath: the engine names the safety backup itself, which is
      // the path where the two samples used to diverge.
      const result = await restoreDatabaseBackup({
        databasePath: activeDatabase,
        backupPath: source,
        repositoryRoot,
        now: frozen
      });

      assert.ok(result.safetyBackupPath, "a safety backup must have been taken");
      const { manifest } = inspectDatabaseBackup(result.safetyBackupPath);
      assert.equal(
        stemTimestamp(result.safetyBackupPath),
        fileTimestamp(manifest.createdAt),
        "the safety backup's filename stamp must equal its manifest createdAt"
      );
      assert.equal(manifest.createdAt, frozen.toISOString());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);

/** dayflow-safety-before-restore-<stamp>-<uuid8>.dayflow-backup */
function stemTimestamp(backupPath: string) {
  const parts = basename(backupPath).replace(/\.dayflow-backup$/, "").split("-");
  return parts[parts.length - 2];
}

/** The same shape timestampForFile produces: millis stripped, ":" and "-" removed. */
function fileTimestamp(isoInstant: string) {
  return isoInstant.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "").replaceAll("-", "");
}


test(
  "backup and restore round-trip all records and reject a corrupt artifact safely",
  { timeout: 120_000 },
  () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-backup-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupArtifact = join(
      temporaryDirectory,
      "complete.dayflow-backup"
    );
    const firstSafetyBackup = join(
      temporaryDirectory,
      "before-round-trip.dayflow-backup"
    );
    const corruptArtifact = join(
      temporaryDirectory,
      "corrupt.dayflow-backup"
    );
    const corruptAttemptSafetyBackup = join(
      temporaryDirectory,
      "before-corrupt-attempt.dayflow-backup"
    );

    try {
      migrate(activeDatabase);
      insertCompleteFixture(activeDatabase);
      const expectedCounts = recordCounts(activeDatabase);
      const sourceHashBeforeBackup = fileHash(activeDatabase);

      const backup = runScript(
        "scripts/backup-database.ts",
        ["--output", backupArtifact],
        activeDatabase
      );
      assert.equal(
        backup.status,
        0,
        `backup failed\nstdout:\n${backup.stdout}\nstderr:\n${backup.stderr}`
      );
      assert.equal(fileHash(activeDatabase), sourceHashBeforeBackup);
      assert.equal(existsSync(backupArtifact), true);
      assert.equal(
        readFileSync(backupArtifact).subarray(0, 15).toString("utf8"),
        "DAYFLOW-BACKUP\n"
      );
      assert.match(backup.stdout, /Schema version: 20\d{12}_[a-z0-9_]+/);
      assert.match(backup.stdout, /Task: 1/);
      assert.match(backup.stdout, /FocusSession: 1/);
      assert.match(backup.stdout, /Review: 1/);

      rmSync(activeDatabase);

      const restore = runScript(
        "scripts/restore-database.ts",
        [
          "--from",
          backupArtifact,
          "--confirm-replace"
        ],
        activeDatabase
      );
      assert.equal(
        restore.status,
        0,
        `restore failed\nstdout:\n${restore.stdout}\nstderr:\n${restore.stderr}`
      );
      assert.equal(existsSync(firstSafetyBackup), false);
      assert.match(
        restore.stdout,
        /No active database existed; no safety backup was needed/
      );
      assert.match(
        restore.stdout,
        /not needed \(validated disposable restore copy\)/i
      );
      assert.deepEqual(
        migrationSafetyArtifacts(temporaryDirectory),
        []
      );
      assert.match(restore.stdout, /Dayflow restore complete/);
      assert.deepEqual(recordCounts(activeDatabase), expectedCounts);
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT title FROM "Task" WHERE id = 'fixture-task';`
        ),
        "Round-trip every relationship"
      );
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT narrative || '|' || nextPeriodIntention
             FROM "Review"
            WHERE id = 'fixture-review';`
        ),
        "The recovery path held.|Protect the next reliability pass."
      );
      assert.equal(
        queryValue(activeDatabase, "PRAGMA integrity_check;"),
        "ok"
      );
      assert.equal(
        queryValue(
          activeDatabase,
          "SELECT COUNT(*) FROM pragma_foreign_key_check;"
        ),
        "0"
      );

      executeSql(
        activeDatabase,
        `INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'decoy-task', 'This record should be replaced', 'TODO',
           1785000000000, 1785000000000
         );`
      );
      const replacementRestore = runScript(
        "scripts/restore-database.ts",
        [
          "--from",
          backupArtifact,
          "--safety-output",
          firstSafetyBackup,
          "--confirm-replace"
        ],
        activeDatabase
      );
      assert.equal(
        replacementRestore.status,
        0,
        `replacement restore failed\nstdout:\n${replacementRestore.stdout}\nstderr:\n${replacementRestore.stderr}`
      );
      assert.equal(existsSync(firstSafetyBackup), true);
      assert.match(replacementRestore.stdout, /Safety backup created:/);
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT COUNT(*) FROM "Task" WHERE id = 'decoy-task';`
        ),
        "0"
      );

      copyFileSync(backupArtifact, corruptArtifact);
      truncateSync(corruptArtifact, statSync(corruptArtifact).size - 32);
      const activeHashBeforeCorruptAttempt = fileHash(activeDatabase);
      const corruptRestore = runScript(
        "scripts/restore-database.ts",
        [
          "--from",
          corruptArtifact,
          "--safety-output",
          corruptAttemptSafetyBackup,
          "--confirm-replace"
        ],
        activeDatabase
      );

      assert.notEqual(corruptRestore.status, 0);
      assert.match(corruptRestore.stderr, /truncated|checksum/i);
      assert.match(corruptRestore.stderr, /Active database was not replaced/);
      assert.match(corruptRestore.stderr, /Safety backup:/);
      assert.equal(existsSync(corruptAttemptSafetyBackup), true);
      assert.equal(fileHash(activeDatabase), activeHashBeforeCorruptAttempt);
      assert.deepEqual(recordCounts(activeDatabase), expectedCounts);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

function migrate(databasePath: string) {
  const result = runScript(
    "scripts/migrate-database.ts",
    [],
    databasePath
  );
  assert.equal(
    result.status,
    0,
    `migration failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

function runScript(
  relativeScriptPath: string,
  args: string[],
  databasePath: string
) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(repositoryRoot, relativeScriptPath),
      ...args
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

function insertCompleteFixture(databasePath: string) {
  executeSql(
    databasePath,
    `PRAGMA foreign_keys = ON;
     BEGIN;
     INSERT INTO "Project" (
       "id", "name", "desiredOutcome", "status", "createdAt", "updatedAt"
     ) VALUES (
       'fixture-project', 'Reliable local data', 'A tested recovery path',
       'ACTIVE', 1785000000000, 1785000000000
     );
     INSERT INTO "ProjectPhase" (
       "id", "projectId", "name", "sortOrder", "createdAt", "updatedAt"
     ) VALUES (
       'fixture-phase', 'fixture-project', 'Recovery', 1,
       1785000000000, 1785000000000
     );
     INSERT INTO "Task" (
       "id", "title", "date", "status", "priority", "urgentScore",
       "importanceScore", "estimateMinutes", "actualMinutes", "sortOrder",
       "focusQueuePosition", "createdAt", "updatedAt", "projectId", "phaseId"
     ) VALUES (
       'fixture-task', 'Round-trip every relationship', 1785000000000,
       'IN_PROGRESS', 'HIGH', 4, 5, 25, 0, 1, 1,
       1785000000000, 1785000000000, 'fixture-project', 'fixture-phase'
     );
     INSERT INTO "Note" (
       "id", "content", "tags", "date", "taskId", "projectId",
       "createdAt", "updatedAt"
     ) VALUES (
       'fixture-note', 'Backup notes survive', '["recovery"]',
       1785000000000, 'fixture-task', NULL,
       1785000000000, 1785000000000
     );
     INSERT INTO "DiaryEntry" (
       "id", "date", "content", "reflection", "mood", "energy",
       "createdAt", "updatedAt"
     ) VALUES (
       'fixture-diary', 1785000000000, 'A durable day', 'Recovery works',
       4, 4, 1785000000000, 1785000000000
     );
     INSERT INTO "Review" (
       "id", "periodStart", "periodEnd", "narrative",
       "nextPeriodIntention", "createdAt", "updatedAt"
     ) VALUES (
       'fixture-review', 1785000000000, 1785604800000,
       'The recovery path held.', 'Protect the next reliability pass.',
       1785604800000, 1785604800000
     );
     INSERT INTO "Material" (
       "id", "title", "url", "type", "notes", "taskId", "noteId",
       "projectId", "createdAt", "updatedAt"
     ) VALUES (
       'fixture-material', 'SQLite backup notes', 'https://sqlite.org/backup.html',
       'website', 'Reference', 'fixture-task', 'fixture-note', NULL,
       1785000000000, 1785000000000
     );
     INSERT INTO "TimeBlock" (
       "id", "date", "startTime", "endTime", "title", "taskId",
       "createdAt", "updatedAt"
     ) VALUES (
       'fixture-block', 1785000000000, '09:00', '09:25', 'Recovery work',
       'fixture-task', 1785000000000, 1785000000000
     );
     INSERT INTO "FocusSession" (
       "id", "kind", "plannedMinutes", "actualMinutes", "label", "startedAt",
       "status", "completedAt", "needsRecord", "recordedAt",
       "completionNote", "completionCategory", "taskId", "projectId",
       "createdAt", "updatedAt"
     ) VALUES (
       'fixture-focus', 'FOCUS', 25, 25, 'Recovery focus',
       1785000000000, 'COMPLETED', 1785001500000, 0, 1785001500000,
       'Implemented recovery', 'Deep Work', 'fixture-task', NULL,
       1785000000000, 1785001500000
     );
     INSERT INTO "ActivityEntry" (
       "id", "startedAt", "durationMinutes", "category", "note", "origin",
       "taskId", "projectId", "attributedProjectId", "focusSessionId",
       "createdAt", "updatedAt"
     ) VALUES (
       'fixture-activity', 1785000000000, 25, 'Deep Work',
       'Implemented recovery', 'FOCUS', 'fixture-task', NULL,
       'fixture-project', 'fixture-focus', 1785001500000, 1785001500000
     );
     INSERT INTO "TaskScheduleChange" (
       "id", "taskId", "previousDate", "nextDate", "source", "createdAt"
     ) VALUES (
       'fixture-schedule-change', 'fixture-task', NULL, 1785000000000,
       'manual', 1785000000000
     );
     COMMIT;`
  );
}

function recordCounts(databasePath: string) {
  const tableNames = execFileSync(
    "sqlite3",
    [
      "-readonly",
      "-list",
      databasePath,
      `SELECT name
         FROM sqlite_schema
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name;`
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  return Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      Number(
        queryValue(
          databasePath,
          `SELECT COUNT(*) FROM "${tableName.replaceAll('"', '""')}";`
        )
      )
    ])
  );
}

function executeSql(databasePath: string, sql: string) {
  execFileSync("sqlite3", ["-batch", "-bail", databasePath, sql], {
    encoding: "utf8"
  });
}

function queryValue(databasePath: string, sql: string) {
  return execFileSync(
    "sqlite3",
    ["-readonly", "-list", databasePath, sql],
    { encoding: "utf8" }
  ).trim();
}

function fileHash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function migrationSafetyArtifacts(directory: string) {
  const backupDirectory = join(directory, "backups");
  return existsSync(backupDirectory)
    ? readdirSync(backupDirectory)
        .filter((name) =>
          name.startsWith("dayflow-safety-before-migration-")
        )
        .sort()
    : [];
}
