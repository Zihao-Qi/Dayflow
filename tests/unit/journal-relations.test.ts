import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { JournalRequestError } from "../../src/lib/journal-domain";
import {
  resolveJournalAttribution,
  resolveMaterialRelations
} from "../../src/lib/journal-relations";

test("Journal attribution rejects a direct Project that conflicts with the Task", async () => {
  const transaction = fakeTransaction({
    task: { id: "task-1", projectId: "project-1" }
  });

  await assert.rejects(
    resolveJournalAttribution(transaction, {
      taskId: "task-1",
      projectId: "project-2"
    }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "ATTRIBUTION_CONFLICT" &&
      error.status === 409
  );
});

test("Journal attribution validates and keeps a direct Project for a standalone Task", async () => {
  const transaction = fakeTransaction({
    task: { id: "task-1", projectId: null },
    project: { id: "project-1" }
  });

  assert.deepEqual(
    await resolveJournalAttribution(transaction, {
      taskId: "task-1",
      projectId: "project-1"
    }),
    {
      taskId: "task-1",
      projectId: "project-1",
      effectiveProjectId: "project-1"
    }
  );
});

test("Material relationships reject Project attribution that conflicts with the linked Note", async () => {
  const transaction = fakeTransaction({
    project: { id: "project-2" },
    note: {
      id: "note-1",
      projectId: "project-1",
      task: null
    }
  });

  await assert.rejects(
    resolveMaterialRelations(transaction, {
      title: "Reference",
      url: "https://example.com",
      type: "website",
      notes: "",
      taskId: null,
      noteId: "note-1",
      projectId: "project-2"
    }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "ATTRIBUTION_CONFLICT" &&
      error.status === 409
  );
});

type FakeRecords = {
  task?: { id: string; projectId: string | null };
  project?: { id: string };
  note?: {
    id: string;
    projectId: string | null;
    task: { projectId: string | null } | null;
  };
};

function fakeTransaction(records: FakeRecords) {
  return {
    task: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        records.task?.id === where.id ? records.task : null
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        records.project?.id === where.id ? records.project : null
    },
    note: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        records.note?.id === where.id ? records.note : null
    }
  } as unknown as Prisma.TransactionClient;
}
