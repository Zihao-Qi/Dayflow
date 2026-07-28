import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const repositoryRoot = process.cwd();
const prismaCliPath = join(repositoryRoot, "node_modules", "prisma", "build", "index.js");

export const testDatabasePath = join(tmpdir(), "dayflow-playwright.db");
export const testDatabaseUrl = `file:${testDatabasePath.split(sep).join("/")}`;
export const testBackupDirectory = join(
  tmpdir(),
  "dayflow-playwright-backups"
);

const resetSql = [
  "PRAGMA foreign_keys = OFF;",
  'DELETE FROM "MutationReceipt";',
  'DELETE FROM "TaskScheduleChange";',
  'DELETE FROM "FocusSession";',
  'DELETE FROM "ActivityEntry";',
  'DELETE FROM "TimeBlock";',
  'DELETE FROM "Material";',
  'DELETE FROM "Note";',
  'DELETE FROM "DiaryEntry";',
  'DELETE FROM "Task";',
  'DELETE FROM "ProjectPhase";',
  'DELETE FROM "Project";',
  "PRAGMA foreign_keys = ON;"
].join(" ");

function runPrismaDbExecute(args: string[], input?: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", ...args, "--url", testDatabaseUrl],
    {
      cwd: repositoryRoot,
      input,
      stdio: input ? ["pipe", "inherit", "inherit"] : "inherit"
    }
  );
}

export function prepareTestDatabase() {
  resetTestBackupDirectory();
  rmSync(testDatabasePath, { force: true });
  runPrismaDbExecute(["--file", "prisma/init.sql"]);
}

export function resetTestDatabase() {
  resetTestBackupDirectory();
  runPrismaDbExecute(["--stdin"], resetSql);
}

function resetTestBackupDirectory() {
  const expectedDirectory = join(tmpdir(), "dayflow-playwright-backups");
  if (testBackupDirectory !== expectedDirectory) {
    throw new Error("Refusing to remove an unexpected browser-test backup path.");
  }
  rmSync(testBackupDirectory, { recursive: true, force: true });
  mkdirSync(testBackupDirectory, { recursive: true, mode: 0o700 });
}

export function seedJournalHistory(count = 105) {
  const baseTimestamp = Date.UTC(2026, 0, 1, 12);
  const statements: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const timestamp = baseTimestamp + index * 1_000;
    statements.push(
      `INSERT INTO "Note"
       ("id", "content", "tags", "date", "createdAt", "updatedAt")
       VALUES
       ('journal-note-${suffix}', 'History note ${suffix}', '[]',
        ${baseTimestamp}, ${timestamp}, ${timestamp});`,
      `INSERT INTO "Material"
       ("id", "title", "url", "type", "notes", "createdAt", "updatedAt")
       VALUES
       ('journal-material-${suffix}', 'History reference ${suffix}',
        'https://example.com/history/${suffix}', 'website', '',
        ${timestamp}, ${timestamp});`
    );
  }
  runPrismaDbExecute(["--stdin"], statements.join("\n"));
}

export function setFocusSessionElapsedMinutes(id: string, minutes: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Focus session id contains unexpected characters.");
  }
  const safeMinutes = Math.max(1, Math.floor(minutes));
  const pausedAt = Date.now();
  const startedAt = pausedAt - safeMinutes * 60_000;
  runPrismaDbExecute(
    ["--stdin"],
    `UPDATE "FocusSession"
     SET "startedAt" = ${startedAt},
         "pausedAt" = ${pausedAt},
         "accumulatedPauseSeconds" = 0
     WHERE "id" = '${id}';`
  );
}
