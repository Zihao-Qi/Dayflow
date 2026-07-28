import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  EvidenceAttributionError,
  resolveTaskProjectAttribution
} from "../../src/lib/evidence-attribution";

test("Activity attribution uses the supplied transaction client", async () => {
  const queries: string[] = [];
  const transaction = fakeTransaction(
    {
      task: { id: "task-1", projectId: null },
      project: { id: "project-1" }
    },
    queries
  );

  assert.deepEqual(
    await resolveTaskProjectAttribution(
      "task-1",
      "project-1",
      transaction
    ),
    {
      taskId: "task-1",
      projectId: "project-1",
      attributedProjectId: "project-1"
    }
  );
  assert.deepEqual(queries, ["task:task-1", "project:project-1"]);
});

test("Task Project attribution remains historical and rejects conflicts", async () => {
  const transaction = fakeTransaction({
    task: { id: "task-1", projectId: "project-1" }
  });

  assert.deepEqual(
    await resolveTaskProjectAttribution("task-1", null, transaction),
    {
      taskId: "task-1",
      projectId: null,
      attributedProjectId: "project-1"
    }
  );

  await assert.rejects(
    resolveTaskProjectAttribution("task-1", "project-2", transaction),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceAttributionError);
      assert.equal(error.code, "ATTRIBUTION_CONFLICT");
      assert.equal(error.field, "projectId");
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test("Missing Activity relationships return typed not-found errors", async () => {
  const transaction = fakeTransaction({});

  await assert.rejects(
    resolveTaskProjectAttribution("missing-task", null, transaction),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceAttributionError);
      assert.equal(error.code, "RELATIONSHIP_NOT_FOUND");
      assert.equal(error.field, "taskId");
      assert.equal(error.status, 404);
      return true;
    }
  );

  await assert.rejects(
    resolveTaskProjectAttribution(null, "missing-project", transaction),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceAttributionError);
      assert.equal(error.code, "RELATIONSHIP_NOT_FOUND");
      assert.equal(error.field, "projectId");
      assert.equal(error.status, 404);
      return true;
    }
  );
});

type FakeRecords = {
  task?: { id: string; projectId: string | null };
  project?: { id: string };
};

function fakeTransaction(records: FakeRecords, queries: string[] = []) {
  return {
    task: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        queries.push(`task:${where.id}`);
        return records.task?.id === where.id ? records.task : null;
      }
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        queries.push(`project:${where.id}`);
        return records.project?.id === where.id ? records.project : null;
      }
    }
  } as unknown as Prisma.TransactionClient;
}
