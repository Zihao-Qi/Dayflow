import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  ActivityPersistenceError,
  replaceManualActivityInTransaction
} from "../../src/server/evidence";

test("Activity replacement returns a typed conflict when its optimistic write loses", async () => {
  const updatedAt = new Date("2026-07-28T15:00:00-05:00");
  let findCalls = 0;
  const transaction = {
    activityEntry: {
      findUnique: async () => {
        findCalls += 1;
        return {
          id: "activity-1",
          startedAt: new Date("2026-07-28T09:00:00-05:00"),
          origin: "MANUAL",
          taskId: null,
          projectId: null,
          attributedProjectId: null,
          focusSessionId: null,
          updatedAt
        };
      },
      updateMany: async (args: { where: { updatedAt: Date } }) => {
        assert.equal(args.where.updatedAt, updatedAt);
        return { count: 0 };
      }
    }
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    () =>
      replaceManualActivityInTransaction(transaction, "activity-1", {
        startTime: "10:15",
        durationMinutes: 35,
        category: "Learning",
        note: "Corrected Activity evidence",
        taskId: null,
        projectId: null
      }),
    (error: unknown) => {
      assert.ok(error instanceof ActivityPersistenceError);
      assert.equal(error.code, "CONFLICT");
      assert.equal(error.status, 409);
      return true;
    }
  );
  assert.equal(findCalls, 1);
});
