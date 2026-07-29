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
    task: { id: "task-1", projectId: "project-1" },
    project: { id: "project-2" }
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

test("Journal attribution reports a missing direct Project before classifying a conflict", async () => {
  const transaction = fakeTransaction({
    task: { id: "task-1", projectId: "project-1" }
  });

  await assert.rejects(
    resolveJournalAttribution(transaction, {
      taskId: "task-1",
      projectId: "missing-project"
    }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "RELATIONSHIP_NOT_FOUND" &&
      error.status === 404 &&
      error.message === "The linked project could not be found."
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

test("Material relationships keep compatible Task and Note provenance", async () => {
  const transaction = fakeTransaction({
    task: { id: "task-1", projectId: "project-1" },
    note: {
      id: "note-1",
      projectId: null,
      task: { projectId: "project-1" }
    }
  });

  assert.deepEqual(
    await resolveMaterialRelations(transaction, {
      title: "Reference",
      url: "https://example.com",
      type: "website",
      notes: "",
      taskId: "task-1",
      noteId: "note-1",
      projectId: null
    }),
    {
      taskId: "task-1",
      projectId: null,
      effectiveProjectId: "project-1",
      noteId: "note-1"
    }
  );
});

test("A linked Note records provenance without independently attributing its Reference", async () => {
  const transaction = fakeTransaction({
    note: {
      id: "note-1",
      projectId: "project-1",
      task: null
    }
  });

  assert.deepEqual(
    await resolveMaterialRelations(transaction, {
      title: "Reference",
      url: "https://example.com",
      type: "website",
      notes: "",
      taskId: null,
      noteId: "note-1",
      projectId: null
    }),
    {
      taskId: null,
      projectId: null,
      effectiveProjectId: null,
      noteId: "note-1"
    }
  );
});

test("Journal relationships report missing Task, Project, and Note targets", async () => {
  const transaction = fakeTransaction({});

  for (const [action, message] of [
    [
      () =>
        resolveJournalAttribution(transaction, {
          taskId: "missing-task",
          projectId: null
        }),
      "The linked task could not be found."
    ],
    [
      () =>
        resolveJournalAttribution(transaction, {
          taskId: null,
          projectId: "missing-project"
        }),
      "The linked project could not be found."
    ],
    [
      () =>
        resolveMaterialRelations(transaction, {
          title: "Reference",
          url: "https://example.com",
          type: "website",
          notes: "",
          taskId: null,
          noteId: "missing-note",
          projectId: null
        }),
      "The linked note could not be found."
    ]
  ] as const) {
    await assert.rejects(
      action,
      (error) =>
        error instanceof JournalRequestError &&
        error.code === "RELATIONSHIP_NOT_FOUND" &&
        error.status === 404 &&
        error.message === message
    );
  }
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
