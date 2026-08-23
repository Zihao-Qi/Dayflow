import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { mutationRequestHash } from "../../src/lib/idempotent-mutations";

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
  'DELETE FROM "Review";',
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

export function seedJournalSearchHistory(count = 125) {
  const baseTimestamp = Date.UTC(2026, 1, 1, 12);
  const statements: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const timestamp = baseTimestamp + index * 1_000;
    const searchableNote = index % 2 === 0;
    const noteContent = searchableNote
      ? `Needle note ${suffix}`
      : `Ordinary note ${suffix}`;
    const tags = searchableNote
      ? '["design-systems","archive"]'
      : '["design"]';
    const materialField = index % 3;
    const materialTitle =
      materialField === 0
        ? `Beacon title ${suffix}`
        : `History reference ${suffix}`;
    const materialUrl =
      materialField === 1
        ? `https://example.com/beacon/${suffix}`
        : `https://example.com/history/${suffix}`;
    const materialNotes =
      materialField === 2 ? `Beacon notes ${suffix}` : "";
    statements.push(
      `INSERT INTO "Note"
       ("id", "content", "tags", "date", "createdAt", "updatedAt")
       VALUES
       ('search-note-${suffix}', '${noteContent}', '${tags}',
        ${baseTimestamp}, ${timestamp}, ${timestamp});`,
      `INSERT INTO "Material"
       ("id", "title", "url", "type", "notes", "createdAt", "updatedAt")
       VALUES
       ('search-material-${suffix}', '${materialTitle}',
        '${materialUrl}', 'website', '${materialNotes}',
        ${timestamp}, ${timestamp});`
    );
  }
  runPrismaDbExecute(["--stdin"], statements.join("\n"));
}

export function seedJournalSearchTies() {
  const timestamp = Date.UTC(2026, 2, 1, 12);
  runPrismaDbExecute(
    ["--stdin"],
    ["a", "b", "c"]
      .map(
        (suffix) => `
          INSERT INTO "Note"
          ("id", "content", "tags", "date", "createdAt", "updatedAt")
          VALUES
          ('search-tie-${suffix}', 'Tie search ${suffix}', '[]',
           ${timestamp}, ${timestamp}, ${timestamp});
        `
      )
      .join("\n")
  );
}

export function seedMalformedJournalTags() {
  const timestamp = Date.UTC(2026, 2, 2, 12);
  runPrismaDbExecute(
    ["--stdin"],
    `INSERT INTO "Note"
     ("id", "content", "tags", "date", "createdAt", "updatedAt")
     VALUES
     ('search-tags-scalar', 'Malformed scalar tags', '"design"',
      ${timestamp}, ${timestamp}, ${timestamp}),
     ('search-tags-object', 'Malformed object tags', '{"x":"design"}',
      ${timestamp}, ${timestamp}, ${timestamp});`
  );
}

/**
 * Give a Focus Session a known elapsed time.
 *
 * The generated Activity inherits the session's startedAt, and a RUNNING
 * session's elapsed time is measured against the wall clock. Backdating
 * startedAt from "now" therefore couples the fixture's duration to its
 * calendar day: run this within `minutes` of local midnight and the Activity
 * lands on yesterday, which is what made the Focus suite fail whenever a run
 * crossed midnight.
 *
 * Pausing the session decouples the two. Elapsed time becomes
 * pausedAt - startedAt regardless of the wall clock, so the window can be held
 * inside today without changing the duration under test.
 */
export function setFocusSessionElapsedMinutes(id: string, minutes: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Focus session id contains unexpected characters.");
  }
  const safeMinutes = Math.max(1, Math.floor(minutes));
  const elapsedMs = safeMinutes * 60_000;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  let pausedAt = Date.now();
  let startedAt = pausedAt - elapsedMs;

  // Away from midnight the session stays RUNNING and this behaves exactly as
  // it always has, so the running-finish path keeps its coverage. Only when
  // backdating would leave today do we hold the window inside the day and
  // pause, which makes elapsed time independent of the wall clock.
  const crossesMidnight = startedAt < dayStart.getTime();
  if (crossesMidnight) {
    startedAt = dayStart.getTime();
    pausedAt = startedAt + elapsedMs;
  }

  runPrismaDbExecute(
    ["--stdin"],
    `UPDATE "FocusSession"
     SET "startedAt" = ${startedAt},
         "pausedAt" = ${pausedAt},
         "accumulatedPauseSeconds" = 0${
           crossesMidnight ? `,\n         "status" = 'PAUSED'` : ""
         }
     WHERE "id" = '${id}';`
  );
}

export function setCompletedFocusSessionInterval(
  id: string,
  date: string,
  startTime: string,
  endTime: string
) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Focus session id contains unexpected characters.");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
  ) {
    throw new Error("Focus session interval is not canonical.");
  }

  const startedAt = new Date(`${date}T${startTime}:00`);
  const completedAt = new Date(`${date}T${endTime}:00`);
  const actualMinutes = Math.floor(
    (completedAt.getTime() - startedAt.getTime()) / 60_000
  );
  if (
    !Number.isFinite(startedAt.getTime()) ||
    !Number.isFinite(completedAt.getTime()) ||
    actualMinutes < 1
  ) {
    throw new Error("Focus session interval must end after it starts.");
  }

  runPrismaDbExecute(
    ["--stdin"],
    `UPDATE "FocusSession"
     SET "activeKey" = NULL,
         "startedAt" = ${startedAt.getTime()},
         "pausedAt" = NULL,
         "accumulatedPauseSeconds" = 0,
         "status" = 'COMPLETED',
         "completedAt" = ${completedAt.getTime()},
         "actualMinutes" = ${actualMinutes},
         "needsRecord" = false
     WHERE "id" = '${id}';`
  );
}

export function seedMalformedTimeBlock(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Malformed Time Block seed date is not canonical.");
  }
  const timestamp = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("Malformed Time Block seed date is invalid.");
  }
  runPrismaDbExecute(
    ["--stdin"],
    `INSERT INTO "TimeBlock"
     ("id", "date", "startTime", "endTime", "title", "taskId", "createdAt", "updatedAt")
     VALUES
     ('malformed-time-block', ${timestamp}, '09:00', '10:00',
      '   ', NULL, ${timestamp}, ${timestamp});`
  );
}

export function seedPreviousDayTimeBlockReceipt(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Previous-day Time Block date is not canonical.");
  }
  const timestamp = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("Previous-day Time Block date is invalid.");
  }

  const mutationId = "e2e-time-block-before-midnight";
  const payload = {
    date,
    startTime: "22:00",
    endTime: "22:30",
    title: "Saved before midnight",
    taskId: null
  };
  const response = {
    id: "time-block-before-midnight",
    ...payload,
    createdAt: new Date(timestamp).toISOString(),
    task: null
  };
  const requestHash = mutationRequestHash("time-block.create", payload);
  const responseJson = JSON.stringify(response).replaceAll("'", "''");
  runPrismaDbExecute(
    ["--stdin"],
    `INSERT INTO "TimeBlock"
     ("id", "date", "startTime", "endTime", "title", "taskId", "createdAt", "updatedAt")
     VALUES
     ('${response.id}', ${timestamp}, '${payload.startTime}',
      '${payload.endTime}', '${payload.title}', NULL, ${timestamp}, ${timestamp});
     INSERT INTO "MutationReceipt"
     ("id", "kind", "requestHash", "responseJson", "createdAt")
     VALUES
     ('${mutationId}', 'time-block.create', '${requestHash}',
      '${responseJson}', ${timestamp});`
  );
  return { mutationId, payload, response };
}
