import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = process.cwd();
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "dayflow-migration-test-")
);
const freshDatabase = join(temporaryDirectory, "fresh.db");
const legacyDatabase = join(temporaryDirectory, "legacy.db");
const currentSetupDatabase = join(temporaryDirectory, "current-setup.db");
const preProjectDatabase = join(temporaryDirectory, "pre-project.db");
const earliestDatabase = join(temporaryDirectory, "earliest.db");
const projectEraDatabase = join(temporaryDirectory, "project-era.db");
const focusEraDatabase = join(temporaryDirectory, "focus-era.db");
const existingSetupDatabase = join(temporaryDirectory, "existing-setup.db");
const seededSetupDatabase = join(temporaryDirectory, "seeded-setup.db");

try {
  runMigration(freshDatabase);
  assert.equal(query(freshDatabase, "PRAGMA integrity_check;"), "ok");
  assert.equal(appliedMigrationCount(freshDatabase), "3");

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
  assert.equal(appliedMigrationCount(legacyDatabase), "3");
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
  assert.equal(appliedMigrationCount(currentSetupDatabase), "3");

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
  runMigration(preProjectDatabase);
  assert.equal(appliedMigrationCount(preProjectDatabase), "3");
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
  runMigration(earliestDatabase);
  assert.equal(appliedMigrationCount(earliestDatabase), "3");
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
  assert.equal(appliedMigrationCount(projectEraDatabase), "3");
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
  assert.equal(appliedMigrationCount(focusEraDatabase), "3");
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

function query(databasePath: string, sql: string) {
  return execFileSync("sqlite3", [databasePath, sql], {
    encoding: "utf8"
  }).trim();
}
