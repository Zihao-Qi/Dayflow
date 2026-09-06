import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { GET as downloadCsv } from "../../src/app/api/exports/[kind]/route";
import {
  csvExportResponseHeaders,
  isCsvExportFileName,
  parseCsvExportResponseMetadata
} from "../../src/lib/csv-export-contract";
import { prisma } from "../../src/lib/prisma";
import { clock } from "../../src/lib/time";
import { activityHeaders, taskHeaders } from "../csv-test-helpers";

// Route reads now enter a transaction before calling these delegates.
const originalTransactionRoot = prisma.$transaction;
beforeEach(() => {
  (prisma as unknown as { $transaction: unknown }).$transaction = async (
    operation: (tx: typeof prisma) => unknown
  ) => operation(prisma);
});
afterEach(() => { prisma.$transaction = originalTransactionRoot; });

for (const kind of ["tasks", "activities"] as const) {
  test(`CSV ${kind} reads inside the transaction and encodes after it closes`, async (context) => {
    const events: string[] = [];
    const now = new Date("2026-07-28T17:00:00.000Z");
    context.mock.method(clock, "now", () => now);
    const row = {
      get id() { events.push("encode"); return "row-1"; },
      title: '\u00A0=SUM(1,2)\n"quoted"',
      status: "DONE", priority: "HIGH", date: null, deadline: null,
      estimateMinutes: 45, actualMinutes: 12, urgentScore: 4, importanceScore: 5,
      sortOrder: 3, focusQueuePosition: null, completedAt: now,
      projectId: null, phaseId: null, project: null, phase: null,
      createdAt: now, updatedAt: now,
      startedAt: now, durationMinutes: 35, category: "Deep, Work",
      note: '\u0085+SUM(1,1)\r\nKept "literal"', origin: "MANUAL",
      taskId: null, task: null, attributedProjectId: null,
      attributedProject: null, focusSessionId: null
    };
    const findMany = async () => {
      events.push("read");
      return [row];
    };
    // Only the callback's client can read; a singleton escape fails the request.
    for (const delegate of [prisma.task, prisma.activityEntry]) {
      const original = delegate.findMany;
      Object.assign(delegate, { findMany: async () => {
        throw new Error("CSV read escaped the transaction client");
      } });
      context.after(() => { Object.assign(delegate, { findMany: original }); });
    }
    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (tx: unknown) => Promise<unknown>
    ) => {
      events.push("transaction-open");
      const result = await operation({ task: { findMany }, activityEntry: { findMany } });
      events.push("callback-resolved");
      await Promise.resolve();
      events.push("transaction-closed");
      return result;
    };

    const response = await downloadCsv(
      new Request(`http://localhost/api/exports/${kind}`),
      { params: Promise.resolve({ kind }) }
    );
    assert.equal(response.status, 200);
    const headers = kind === "tasks" ? taskHeaders : activityHeaders;
    const record = kind === "tasks"
      ? 'row-1,"\'\u00A0=SUM(1,2)\n""quoted""",DONE,HIGH,,,45,12,4,5,3,,2026-07-28T17:00:00.000Z,,,,,2026-07-28T17:00:00.000Z,2026-07-28T17:00:00.000Z'
      : 'row-1,2026-07-28T17:00:00.000Z,2026-07-28,12:00,America/Chicago,35,"Deep, Work","\'\u0085+SUM(1,1)\r\nKept ""literal""",MANUAL,,,,,,,,2026-07-28T17:00:00.000Z,2026-07-28T17:00:00.000Z';
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      Buffer.from(`\uFEFF${headers.join(",")}\r\n${record}\r\n`, "utf8")
    );
    assert.deepEqual(Object.fromEntries(response.headers), {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="dayflow-${kind}-2026-07-28.csv"`,
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-dayflow-export-format": "dayflow-csv",
      "x-dayflow-export-kind": kind,
      "x-dayflow-export-version": "1",
      "x-dayflow-file-name": `dayflow-${kind}-2026-07-28.csv`,
      "x-dayflow-record-count": "1"
    });
    assert.deepEqual(events, [
      "transaction-open", "read", "callback-resolved", "transaction-closed", "encode"
    ]);
  });
}

test("CSV export route rejects unsupported kinds without attachment headers", async () => {
  const response = await downloadCsv(
    new Request("http://localhost/api/exports/projects"),
    { params: Promise.resolve({ kind: "projects" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "CSV export not found.",
    code: "EXPORT_NOT_FOUND"
  });
  assert.equal(response.headers.get("Content-Disposition"), null);
  assert.match(
    response.headers.get("Content-Type") ?? "",
    /^application\/json/
  );
});

test("CSV response metadata round trips through the shared strict contract", () => {
  const headers = new Headers(
    csvExportResponseHeaders({
      kind: "tasks",
      fileName: "dayflow-tasks-2026-07-28.csv",
      recordCount: 12
    })
  );

  assert.deepEqual(parseCsvExportResponseMetadata("tasks", headers), {
    fileName: "dayflow-tasks-2026-07-28.csv",
    recordCount: 12
  });

  headers.set("Content-Type", "text/csv; charset=iso-8859-1");
  assert.equal(parseCsvExportResponseMetadata("tasks", headers), null);
});

test("CSV filenames require a real local calendar date", () => {
  assert.equal(
    isCsvExportFileName("activities", "dayflow-activities-2026-02-28.csv"),
    true
  );
  assert.equal(
    isCsvExportFileName("activities", "dayflow-activities-2026-02-30.csv"),
    false
  );
  assert.equal(
    isCsvExportFileName("activities", "dayflow-activities-2026-99-99.csv"),
    false
  );
});

test("CSV export route pins its internal error envelope", async () => {
  const originalFindMany = prisma.task.findMany;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma.task as unknown as { findMany: unknown }).findMany = async () => {
      throw new Error("unexpected");
    };
    const response = await downloadCsv(
      new Request("http://localhost/api/exports/tasks"),
      { params: Promise.resolve({ kind: "tasks" }) }
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "CSV export could not be created.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma.task as unknown as { findMany: unknown }).findMany =
      originalFindMany;
    console.error = originalConsoleError;
  }
});
