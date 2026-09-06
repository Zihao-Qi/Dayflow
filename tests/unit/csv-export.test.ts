import assert from "node:assert/strict";
import test from "node:test";
import {
  createCsvExport,
  CsvExportError,
  parseCsvExportKind,
  readCsvExport
} from "../../src/lib/csv-export";
import {
  activityHeaders,
  parseCsv,
  taskHeaders
} from "../csv-test-helpers";

type CsvExportDatabase = NonNullable<
  Parameters<typeof readCsvExport>[1]
>;

test("Task CSV has stable columns, calendar dates, relationships, and formula safety", async () => {
  let query: unknown;
  const database = {
    task: {
      findMany: async (args: unknown) => {
        query = args;
        return [
          {
            id: "task-1",
            title: '\u00A0=SUM(1,2)\n"quoted"',
            status: "DONE",
            priority: "HIGH",
            date: new Date("2026-07-28T05:00:00.000Z"),
            deadline: new Date("2026-07-30T05:00:00.000Z"),
            estimateMinutes: 45,
            actualMinutes: 12,
            urgentScore: 4,
            importanceScore: 5,
            sortOrder: 3,
            focusQueuePosition: null,
            completedAt: new Date("2026-07-28T16:00:00.000Z"),
            projectId: "project-1",
            phaseId: "phase-1",
            createdAt: new Date("2026-07-27T13:00:00.000Z"),
            updatedAt: new Date("2026-07-28T16:00:00.000Z"),
            project: { name: "Résumé, launch" },
            phase: { name: "@Opening phase" }
          }
        ];
      }
    },
    activityEntry: { findMany: async () => [] }
  } as unknown as CsvExportDatabase;

  const result = createCsvExport(
    await readCsvExport("tasks", database),
    new Date("2026-07-28T17:00:00.000Z")
  );

  assert.equal(result.kind, "tasks");
  assert.equal(result.fileName, "dayflow-tasks-2026-07-28.csv");
  assert.equal(result.recordCount, 1);
  assert.ok(result.body.startsWith("\uFEFF"));
  assert.ok(result.body.endsWith("\r\n"));

  const records = parseCsv(result.body);
  assert.deepEqual(records[0], taskHeaders);
  assert.deepEqual(records[1], [
    "task-1",
    '\'\u00A0=SUM(1,2)\n"quoted"',
    "DONE",
    "HIGH",
    "2026-07-28",
    "2026-07-30",
    "45",
    "12",
    "4",
    "5",
    "3",
    "",
    "2026-07-28T16:00:00.000Z",
    "project-1",
    "Résumé, launch",
    "phase-1",
    "'@Opening phase",
    "2026-07-27T13:00:00.000Z",
    "2026-07-28T16:00:00.000Z"
  ]);
  assert.deepEqual(query, {
    select: assertTaskSelect(),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
});

test("Activity CSV represents exact and local time with safe related names", async () => {
  let query: unknown;
  const database = {
    task: { findMany: async () => [] },
    activityEntry: {
      findMany: async (args: unknown) => {
        query = args;
        return [
          {
            id: "activity-1",
            startedAt: new Date("2026-07-28T14:05:00.000Z"),
            durationMinutes: 35,
            category: "Deep, Work",
            note: '\u0085+SUM(1,1)\r\nKept "literal"',
            origin: "MANUAL",
            taskId: "task-1",
            projectId: null,
            attributedProjectId: "project-1",
            focusSessionId: null,
            createdAt: new Date("2026-07-28T14:06:00.000Z"),
            updatedAt: new Date("2026-07-28T15:00:00.000Z"),
            task: { title: "-Launch task" },
            project: null,
            attributedProject: { name: "Launch ✨" }
          }
        ];
      }
    }
  } as unknown as CsvExportDatabase;

  const result = createCsvExport(
    await readCsvExport("activities", database),
    new Date("2026-07-28T17:00:00.000Z")
  );
  const records = parseCsv(result.body);

  assert.equal(result.fileName, "dayflow-activities-2026-07-28.csv");
  assert.equal(result.recordCount, 1);
  assert.deepEqual(records[0], activityHeaders);
  assert.deepEqual(records[1], [
    "activity-1",
    "2026-07-28T14:05:00.000Z",
    "2026-07-28",
    "09:05",
    "America/Chicago",
    "35",
    "Deep, Work",
    '\'\u0085+SUM(1,1)\r\nKept "literal"',
    "MANUAL",
    "task-1",
    "'-Launch task",
    "",
    "",
    "project-1",
    "Launch ✨",
    "",
    "2026-07-28T14:06:00.000Z",
    "2026-07-28T15:00:00.000Z"
  ]);
  assert.deepEqual(
    (query as { orderBy: unknown }).orderBy,
    [{ startedAt: "asc" }, { id: "asc" }]
  );
});

test("empty CSV exports keep exact headers and unsupported kinds are typed", async () => {
  const database = {
    task: { findMany: async () => [] },
    activityEntry: { findMany: async () => [] }
  } as unknown as CsvExportDatabase;

  const tasks = createCsvExport(
    await readCsvExport("tasks", database),
    new Date("2026-07-28T17:00:00.000Z")
  );
  const activities = createCsvExport(
    await readCsvExport("activities", database),
    new Date("2026-07-28T17:00:00.000Z")
  );
  assert.deepEqual(parseCsv(tasks.body), [taskHeaders]);
  assert.deepEqual(parseCsv(activities.body), [activityHeaders]);

  assert.throws(
    () => parseCsvExportKind("projects"),
    (error: unknown) => {
      assert.ok(error instanceof CsvExportError);
      assert.equal(error.code, "EXPORT_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    }
  );
});

function assertTaskSelect() {
  return {
    id: true,
    title: true,
    status: true,
    priority: true,
    date: true,
    deadline: true,
    estimateMinutes: true,
    actualMinutes: true,
    urgentScore: true,
    importanceScore: true,
    sortOrder: true,
    focusQueuePosition: true,
    completedAt: true,
    projectId: true,
    phaseId: true,
    createdAt: true,
    updatedAt: true,
    project: { select: { name: true } },
    phase: { select: { name: true } }
  };
}
