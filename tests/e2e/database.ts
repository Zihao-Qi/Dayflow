import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const repositoryRoot = process.cwd();
const prismaCliPath = join(repositoryRoot, "node_modules", "prisma", "build", "index.js");

export const testDatabasePath = join(tmpdir(), "dayflow-playwright.db");
export const testDatabaseUrl = `file:${testDatabasePath.split(sep).join("/")}`;

const resetSql = [
  "PRAGMA foreign_keys = OFF;",
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
  rmSync(testDatabasePath, { force: true });
  runPrismaDbExecute(["--file", "prisma/init.sql"]);
}

export function resetTestDatabase() {
  runPrismaDbExecute(["--stdin"], resetSql);
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
