import assert from "node:assert/strict";
import test from "node:test";
import { GET as downloadCsv } from "../../src/app/api/exports/[kind]/route";
import {
  csvExportResponseHeaders,
  isCsvExportFileName,
  parseCsvExportResponseMetadata
} from "../../src/lib/csv-export-contract";
import { prisma } from "../../src/lib/prisma";

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
