import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { addDays, localDateKey, startOfLocalDay } from "../../src/shared/kernel/calendar";

const now = new Date();
const today = startOfLocalDay(now);
const dayKey = (offset: number) => localDateKey(addDays(today, offset));

type Routes = {
  listHabits: typeof import("../../src/app/api/habits/route").GET;
  createHabit: typeof import("../../src/app/api/habits/route").POST;
  reorderHabits: typeof import("../../src/app/api/habits/route").PATCH;
  patchHabit: typeof import("../../src/app/api/habits/[id]/route").PATCH;
  archiveHabit: typeof import("../../src/app/api/habits/[id]/archive/route").POST;
  recordCheckIn: typeof import("../../src/app/api/habits/[id]/check-in/route").PUT;
};

function jsonRequest(path: string, method: string, body?: unknown, mutationId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mutationId) headers["X-Dayflow-Mutation-Id"] = mutationId;
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function withRoutes(
  context: { after: (fn: () => unknown) => void },
  run: (deps: { prisma: PrismaClient; routes: Routes }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-habit-routes-test-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnect: (() => Promise<void>) | undefined;
  process.env.DATABASE_URL = `file:${join(directory, "dayflow.db").split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnect?.();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "db", "execute", "--file", "prisma/init.sql", "--url", process.env.DATABASE_URL
  ], { cwd: process.cwd(), stdio: "pipe" });

  // Load the routes only after the client is pointed at a disposable database.
  const [habits, habitById, archive, checkIn, { getPrisma }] = await Promise.all([
    import("../../src/app/api/habits/route"),
    import("../../src/app/api/habits/[id]/route"),
    import("../../src/app/api/habits/[id]/archive/route"),
    import("../../src/app/api/habits/[id]/check-in/route"),
    import("../../src/lib/prisma")
  ]);
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  await run({
    prisma,
    routes: {
      listHabits: habits.GET,
      createHabit: habits.POST,
      reorderHabits: habits.PATCH,
      patchHabit: habitById.PATCH,
      archiveHabit: archive.POST,
      recordCheckIn: checkIn.PUT
    }
  });
}

test("Habit routes", async (context) => {
  await withRoutes(context, async ({ prisma, routes }) => {
    await context.test("a Habit is created and listed", async () => {
      const created = await routes.createHabit(
        jsonRequest("/api/habits", "POST", { name: "Morning stretch" })
      );
      assert.equal(created.status, 201);
      const habit = await created.json();
      assert.equal(habit.name, "Morning stretch");
      assert.equal(habit.cadence, "DAILY");
      assert.equal(habit.targetPerWeek, 7);
      assert.equal(habit.status, "ACTIVE");

      const listed = await (await routes.listHabits()).json();
      assert.deepEqual(listed.map((entry: { id: string }) => entry.id), [habit.id]);
    });

    await context.test("recording twice with one mutation id leaves one row", async () => {
      const habit = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Replay" }))
      ).json();
      const body = { date: dayKey(0), done: true, amount: 5 };
      const first = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", body, "check-in-replay"),
        params(habit.id)
      );
      const replay = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", body, "check-in-replay"),
        params(habit.id)
      );
      assert.equal(first.status, 200);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), await first.json());
      assert.equal(await prisma.habitCheckIn.count({ where: { habitId: habit.id } }), 1);
    });

    await context.test("PUT check-in preserves existing amount and note on toggle", async () => {
      const habit = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Route toggle" }))
      ).json();
      await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", {
          date: dayKey(0),
          done: true,
          amount: 25,
          note: "morning routine"
        }),
        params(habit.id)
      );

      // Toggle done only (omitting amount and note)
      const toggled = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", {
          date: dayKey(0),
          done: false
        }),
        params(habit.id)
      );
      assert.equal(toggled.status, 200);
      const row = await toggled.json();
      assert.equal(row.done, false);
      assert.equal(row.amount, 25);
      assert.equal(row.note, "morning routine");

      // Explicit null clears
      const cleared = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", {
          date: dayKey(0),
          done: false,
          amount: null,
          note: null
        }),
        params(habit.id)
      );
      assert.equal(cleared.status, 200);
      const clearedRow = await cleared.json();
      assert.equal(clearedRow.amount, null);
      assert.equal(clearedRow.note, null);
    });

    await context.test("a date outside the backfill window is refused", async () => {
      const habit = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Window" }))
      ).json();
      const response = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", { date: dayKey(-8) }),
        params(habit.id)
      );
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, "VALIDATION_ERROR");
      assert.equal(body.field, "date");
      assert.equal(await prisma.habitCheckIn.count({ where: { habitId: habit.id } }), 0);
    });

    await context.test("an unknown Habit is reported as not found", async () => {
      const response = await routes.recordCheckIn(
        jsonRequest("/api/habits/missing-habit/check-in", "PUT", { date: dayKey(0) }),
        params("missing-habit")
      );
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "HABIT_NOT_FOUND");
    });

    await context.test("patching an unknown Habit is not found, not a crash", async () => {
      const response = await routes.patchHabit(
        jsonRequest("/api/habits/missing-habit", "PATCH", { name: "Nope" }),
        params("missing-habit")
      );
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "HABIT_NOT_FOUND");
    });

    await context.test("archiving keeps the Check-ins and clears the list", async () => {
      const habit = await (
        await routes.createHabit(
          jsonRequest("/api/habits", "POST", {
            name: "Retire", cadence: "TIMES_PER_WEEK", targetPerWeek: 3
          })
        )
      ).json();
      await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit.id}/check-in`, "PUT", { date: dayKey(-1) }),
        params(habit.id)
      );
      const archived = await routes.archiveHabit(
        jsonRequest(`/api/habits/${habit.id}/archive`, "POST"),
        params(habit.id)
      );
      assert.equal(archived.status, 200);
      assert.equal((await archived.json()).status, "ARCHIVED");

      const listed = await (await routes.listHabits()).json();
      assert.equal(listed.some((entry: { id: string }) => entry.id === habit.id), false);
      assert.equal(await prisma.habitCheckIn.count({ where: { habitId: habit.id } }), 1);
    });

    await context.test("patching and archiving with mutation id are idempotent", async () => {
      const habit = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Patch target" }))
      ).json();
      const patch1 = await routes.patchHabit(
        jsonRequest(`/api/habits/${habit.id}`, "PATCH", { name: "Renamed" }, "patch-mut-1"),
        params(habit.id)
      );
      assert.equal(patch1.status, 200);
      const patch2 = await routes.patchHabit(
        jsonRequest(`/api/habits/${habit.id}`, "PATCH", { name: "Renamed" }, "patch-mut-1"),
        params(habit.id)
      );
      assert.equal(patch2.status, 200);
      assert.deepEqual(await patch2.json(), await patch1.json());

      const arch1 = await routes.archiveHabit(
        jsonRequest(`/api/habits/${habit.id}/archive`, "POST", undefined, "arch-mut-1"),
        params(habit.id)
      );
      assert.equal(arch1.status, 200);
      const arch2 = await routes.archiveHabit(
        jsonRequest(`/api/habits/${habit.id}/archive`, "POST", undefined, "arch-mut-1"),
        params(habit.id)
      );
      assert.equal(arch2.status, 200);
      assert.deepEqual(await arch2.json(), await arch1.json());
    });

    await context.test("different Habit URLs conflict and leave the second Habit unchanged on PATCH", async () => {
      const habit1 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Patch target 1" }))
      ).json();
      const habit2 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Patch target 2" }))
      ).json();

      const patch1 = await routes.patchHabit(
        jsonRequest(`/api/habits/${habit1.id}`, "PATCH", { habitId: habit1.id, name: "Updated" }, "shared-patch-mut"),
        params(habit1.id)
      );
      assert.equal(patch1.status, 200);
      assert.equal((await patch1.json()).name, "Updated");

      const patch2 = await routes.patchHabit(
        jsonRequest(`/api/habits/${habit2.id}`, "PATCH", { habitId: habit1.id, name: "Updated" }, "shared-patch-mut"),
        params(habit2.id)
      );
      assert.equal(patch2.status, 409);
      const errorBody = await patch2.json();
      assert.equal(errorBody.code, "MUTATION_ID_CONFLICT");

      const storedHabit2 = await prisma.habit.findUniqueOrThrow({ where: { id: habit2.id } });
      assert.equal(storedHabit2.name, "Patch target 2");
    });

    await context.test("different Habit URLs conflict and leave the second Habit unchanged on PUT check-in", async () => {
      const habit1 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "CheckIn target 1" }))
      ).json();
      const habit2 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "CheckIn target 2" }))
      ).json();

      const checkIn1 = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit1.id}/check-in`, "PUT", { habitId: habit1.id, date: dayKey(0), done: true }, "shared-checkin-mut"),
        params(habit1.id)
      );
      assert.equal(checkIn1.status, 200);

      const checkIn2 = await routes.recordCheckIn(
        jsonRequest(`/api/habits/${habit2.id}/check-in`, "PUT", { habitId: habit1.id, date: dayKey(0), done: true }, "shared-checkin-mut"),
        params(habit2.id)
      );
      assert.equal(checkIn2.status, 409);
      const errorBody = await checkIn2.json();
      assert.equal(errorBody.code, "MUTATION_ID_CONFLICT");

      assert.equal(await prisma.habitCheckIn.count({ where: { habitId: habit2.id } }), 0);
    });

    await context.test("reused mutation ID across different Habit archive URLs yields MUTATION_ID_CONFLICT", async () => {
      const habit1 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Archive target 1" }))
      ).json();
      const habit2 = await (
        await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Archive target 2" }))
      ).json();

      const arch1 = await routes.archiveHabit(
        jsonRequest(`/api/habits/${habit1.id}/archive`, "POST", undefined, "shared-arch-mut"),
        params(habit1.id)
      );
      assert.equal(arch1.status, 200);
      assert.equal((await arch1.json()).status, "ARCHIVED");

      const arch2 = await routes.archiveHabit(
        jsonRequest(`/api/habits/${habit2.id}/archive`, "POST", undefined, "shared-arch-mut"),
        params(habit2.id)
      );
      assert.equal(arch2.status, 409);
      const errorBody = await arch2.json();
      assert.equal(errorBody.code, "MUTATION_ID_CONFLICT");

      const storedHabit2 = await prisma.habit.findUniqueOrThrow({ where: { id: habit2.id } });
      assert.equal(storedHabit2.status, "ACTIVE");
      assert.equal(storedHabit2.archivedAt, null);
    });

    await context.test("validation is refused while storage is unavailable", async () => {
      // Parsing must happen before a transaction is opened, so a bad request
      // still gets its own error rather than a storage failure.
      const original = prisma.$transaction;
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw new Error("storage unavailable");
      };
      try {
        const response = await routes.createHabit(
          jsonRequest("/api/habits", "POST", { name: "   " })
        );
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, "VALIDATION_ERROR");
        assert.equal(body.field, "name");
      } finally {
        prisma.$transaction = original;
      }
    });

    await context.test("reordering validates shape, duplicates, and missing fields before opening storage", async () => {
      // Malformed JSON body
      const badJson = new NextRequest("http://localhost/api/habits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{"
      });
      const badJsonResponse = await routes.reorderHabits(badJson);
      assert.equal(badJsonResponse.status, 400);
      assert.equal((await badJsonResponse.json()).code, "INVALID_JSON");

      // Non-object body
      const nonObject = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", "not an object")
      );
      assert.equal(nonObject.status, 400);
      const nonObjBody = await nonObject.json();
      assert.equal(nonObjBody.code, "VALIDATION_ERROR");
      assert.equal(nonObjBody.field, "body");

      // Missing ids
      const missingIds = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { expectedIds: ["h1"] })
      );
      assert.equal(missingIds.status, 400);
      assert.equal((await missingIds.json()).field, "ids");

      // Missing expectedIds
      const missingExpected = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: ["h1"] })
      );
      assert.equal(missingExpected.status, 400);
      assert.equal((await missingExpected.json()).field, "expectedIds");

      // Duplicate ids
      const dupIds = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: ["h1", "h1"], expectedIds: ["h1"] })
      );
      assert.equal(dupIds.status, 400);
      assert.equal((await dupIds.json()).field, "ids");

      // Duplicate expectedIds
      const dupExpected = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: ["h1"], expectedIds: ["h1", "h1"] })
      );
      assert.equal(dupExpected.status, 400);
      assert.equal((await dupExpected.json()).field, "expectedIds");

      // Invalid ID in array (control characters / empty)
      const invalidId = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: [""], expectedIds: [""] })
      );
      assert.equal(invalidId.status, 400);
      assert.equal((await invalidId.json()).field, "ids");

      // Storage unavailable check: validation happens before opening storage
      const original = prisma.$transaction;
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw new Error("storage unavailable");
      };
      try {
        const response = await routes.reorderHabits(
          jsonRequest("/api/habits", "PATCH", { ids: ["h1", "h1"], expectedIds: ["h1"] })
        );
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "VALIDATION_ERROR");
      } finally {
        prisma.$transaction = original;
      }
    });

    await context.test("atomic full reorder persists 0..N-1 sortOrder, reloads correctly, and leaves check-ins and archived rows untouched", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const hA = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Alpha" }))).json();
      const hB = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Beta" }))).json();
      const hC = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Gamma" }))).json();
      const hD = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Delta" }))).json();

      // Check-in on Alpha and Delta
      await routes.recordCheckIn(
        jsonRequest(`/api/habits/${hA.id}/check-in`, "PUT", { date: dayKey(0), done: true, amount: 15, note: "alpha note" }),
        params(hA.id)
      );
      await routes.recordCheckIn(
        jsonRequest(`/api/habits/${hD.id}/check-in`, "PUT", { date: dayKey(-1), done: true, amount: 30, note: "delta note" }),
        params(hD.id)
      );

      // Archive Delta
      await routes.archiveHabit(jsonRequest(`/api/habits/${hD.id}/archive`, "POST"), params(hD.id));

      // Active order is [Alpha, Beta, Gamma]
      const beforeReorder = await (await routes.listHabits()).json();
      assert.deepEqual(beforeReorder.map((h: { id: string }) => h.id), [hA.id, hB.id, hC.id]);

      // Reorder to [Gamma, Alpha, Beta]
      const targetIds = [hC.id, hA.id, hB.id];
      const expectedIds = [hA.id, hB.id, hC.id];
      const reorderResponse = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: targetIds, expectedIds }, "reorder-mut-1")
      );
      assert.equal(reorderResponse.status, 200);
      assert.deepEqual(await reorderResponse.json(), { ids: targetIds });

      // Active list returns reordered sequence
      const afterReorder = await (await routes.listHabits()).json();
      assert.deepEqual(afterReorder.map((h: { id: string }) => h.id), targetIds);

      // Verify contiguous 0..N-1 sortOrder in DB
      const rowC = await prisma.habit.findUniqueOrThrow({ where: { id: hC.id } });
      const rowA = await prisma.habit.findUniqueOrThrow({ where: { id: hA.id } });
      const rowB = await prisma.habit.findUniqueOrThrow({ where: { id: hB.id } });
      assert.equal(rowC.sortOrder, 0);
      assert.equal(rowA.sortOrder, 1);
      assert.equal(rowB.sortOrder, 2);

      // Archived Delta remains archived and untouched
      const rowD = await prisma.habit.findUniqueOrThrow({ where: { id: hD.id } });
      assert.equal(rowD.status, "ARCHIVED");
      assert.notEqual(rowD.archivedAt, null);

      // Check-ins for Alpha and Delta remain intact
      const checkInA = await prisma.habitCheckIn.findFirstOrThrow({ where: { habitId: hA.id } });
      assert.equal(checkInA.amount, 15);
      assert.equal(checkInA.note, "alpha note");
      const checkInD = await prisma.habitCheckIn.findFirstOrThrow({ where: { habitId: hD.id } });
      assert.equal(checkInD.amount, 30);
      assert.equal(checkInD.note, "delta note");
    });

    await context.test("reordering empty arrays succeeds if and only if active list is empty", async () => {
      // When active habits exist, empty array is rejected with 409
      const nonemptyCheck = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: [], expectedIds: [] })
      );
      assert.equal(nonemptyCheck.status, 409);
      assert.equal((await nonemptyCheck.json()).code, "CONFLICT");

      // Archive all remaining active habits
      const activeHabits = await prisma.habit.findMany({ where: { status: "ACTIVE" } });
      for (const h of activeHabits) {
        await routes.archiveHabit(jsonRequest(`/api/habits/${h.id}/archive`, "POST"), params(h.id));
      }

      // Now active list is empty; empty arrays are a valid no-op
      const emptySuccess = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", { ids: [], expectedIds: [] })
      );
      assert.equal(emptySuccess.status, 200);
      assert.deepEqual(await emptySuccess.json(), { ids: [] });
    });

    await context.test("distinct stale schedules return 409 CONFLICT with zero writes", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const h1 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Item 1" }))).json();
      const h2 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Item 2" }))).json();
      const h3 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Item 3" }))).json();

      // Current order: [h1, h2, h3]
      // 1. Stale full-order (same membership, order mismatch): set equality alone must fail
      const staleOrder = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", {
          ids: [h3.id, h2.id, h1.id],
          expectedIds: [h2.id, h1.id, h3.id] // expectedIds permutes same set, but wrong order
        })
      );
      assert.equal(staleOrder.status, 409);
      assert.equal((await staleOrder.json()).code, "CONFLICT");
      // Verify DB unchanged
      const listAfterStale = await (await routes.listHabits()).json();
      assert.deepEqual(listAfterStale.map((h: { id: string }) => h.id), [h1.id, h2.id, h3.id]);

      // 2. Intervening create: client sends expectedIds omitting h3
      const staleCreate = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", {
          ids: [h2.id, h1.id],
          expectedIds: [h1.id, h2.id]
        })
      );
      assert.equal(staleCreate.status, 409);
      assert.equal((await staleCreate.json()).code, "CONFLICT");

      // 3. Intervening archive: archive h3, client still expects [h1, h2, h3]
      await routes.archiveHabit(jsonRequest(`/api/habits/${h3.id}/archive`, "POST"), params(h3.id));
      const staleArchive = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", {
          ids: [h2.id, h1.id, h3.id],
          expectedIds: [h1.id, h2.id, h3.id]
        })
      );
      assert.equal(staleArchive.status, 409);
      assert.equal((await staleArchive.json()).code, "CONFLICT");

      // 4. Foreign/missing ID
      const foreignId = await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", {
          ids: [h2.id, "foreign-habit-id"],
          expectedIds: [h1.id, h2.id]
        })
      );
      assert.equal(foreignId.status, 409);
      assert.equal((await foreignId.json()).code, "CONFLICT");

      // Verify DB still intact [h1, h2]
      const finalActive = await (await routes.listHabits()).json();
      assert.deepEqual(finalActive.map((h: { id: string }) => h.id), [h1.id, h2.id]);
    });

    await context.test("middle-write failure rolls back entire reorder transaction with zero writes and no receipt", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const h1 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Rollback 1" }))).json();
      const h2 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Rollback 2" }))).json();
      const h3 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Rollback 3" }))).json();

      const origTransaction = prisma.$transaction;
      (prisma as unknown as { $transaction: unknown }).$transaction = async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
        return (origTransaction as Function).call(prisma, async (tx: Record<string, unknown>) => {
          const habitModel = tx.habit as Record<string, unknown>;
          const origUpdate = habitModel.update as Function;
          let updateCount = 0;
          habitModel.update = async (args: unknown) => {
            updateCount++;
            if (updateCount === 2) {
              throw new Error("Simulated middle-write failure");
            }
            return origUpdate.call(habitModel, args);
          };
          return fn(tx);
        }, opts);
      };

      try {
        const response = await routes.reorderHabits(
          jsonRequest(
            "/api/habits",
            "PATCH",
            { ids: [h3.id, h1.id, h2.id], expectedIds: [h1.id, h2.id, h3.id] },
            "fail-middle-write-mut"
          )
        );
        assert.equal(response.status, 500);
        assert.equal((await response.json()).code, "INTERNAL_ERROR");
      } finally {
        prisma.$transaction = origTransaction;
      }

      // Assert zero partial writes: row 1 was NOT modified, all retain their previous sortOrders
      const row1 = await prisma.habit.findUniqueOrThrow({ where: { id: h1.id } });
      const row2 = await prisma.habit.findUniqueOrThrow({ where: { id: h2.id } });
      const row3 = await prisma.habit.findUniqueOrThrow({ where: { id: h3.id } });
      assert.equal(row1.sortOrder, 0);
      assert.equal(row2.sortOrder, 1);
      assert.equal(row3.sortOrder, 2);

      // Assert no receipt was inserted
      assert.equal(
        await prisma.mutationReceipt.count({ where: { id: "fail-middle-write-mut" } }),
        0
      );
    });

    await context.test("receipt-insertion failure rolls back entire reorder transaction with zero writes", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const h1 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Receipt-fail 1" }))).json();
      const h2 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Receipt-fail 2" }))).json();

      const origTransaction = prisma.$transaction;
      (prisma as unknown as { $transaction: unknown }).$transaction = async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
        return (origTransaction as Function).call(prisma, async (tx: Record<string, unknown>) => {
          const receiptModel = tx.mutationReceipt as Record<string, unknown>;
          receiptModel.create = async () => {
            throw new Error("Simulated receipt insertion failure");
          };
          return fn(tx);
        }, opts);
      };

      try {
        const response = await routes.reorderHabits(
          jsonRequest(
            "/api/habits",
            "PATCH",
            { ids: [h2.id, h1.id], expectedIds: [h1.id, h2.id] },
            "fail-receipt-insert-mut"
          )
        );
        assert.equal(response.status, 500);
        assert.equal((await response.json()).code, "INTERNAL_ERROR");
      } finally {
        prisma.$transaction = origTransaction;
      }

      // Verify zero writes occurred
      const row1 = await prisma.habit.findUniqueOrThrow({ where: { id: h1.id } });
      const row2 = await prisma.habit.findUniqueOrThrow({ where: { id: h2.id } });
      assert.equal(row1.sortOrder, 0);
      assert.equal(row2.sortOrder, 1);
      assert.equal(
        await prisma.mutationReceipt.count({ where: { id: "fail-receipt-insert-mut" } }),
        0
      );
    });

    await context.test("equal sortOrder AND equal createdAt resolves deterministically by id; new Habit appends after reorder", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const hA = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Tie A" }))).json();
      const hB = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Tie B" }))).json();

      const sameDate = new Date("2026-09-01T10:00:00Z");
      // Set equal sortOrder and equal createdAt directly in DB
      await prisma.habit.update({ where: { id: hA.id }, data: { sortOrder: 0, createdAt: sameDate } });
      await prisma.habit.update({ where: { id: hB.id }, data: { sortOrder: 0, createdAt: sameDate } });

      const [expectedFirstId, expectedSecondId] = [hA.id, hB.id].sort();
      const tieListed = await (await routes.listHabits()).json();
      assert.deepEqual(tieListed.map((h: { id: string }) => h.id), [expectedFirstId, expectedSecondId]);

      // Reorder explicitly so [expectedSecondId, expectedFirstId] get sortOrders 0, 1
      await routes.reorderHabits(
        jsonRequest("/api/habits", "PATCH", {
          ids: [expectedSecondId, expectedFirstId],
          expectedIds: [expectedFirstId, expectedSecondId]
        })
      );

      // Create new habit: it must append after existing active habits (sortOrder = count(ACTIVE) = 2)
      const hC = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Appended" }))).json();
      const rowC = await prisma.habit.findUniqueOrThrow({ where: { id: hC.id } });
      assert.equal(rowC.sortOrder, 2);

      const afterAppendList = await (await routes.listHabits()).json();
      assert.deepEqual(
        afterAppendList.map((h: { id: string }) => h.id),
        [expectedSecondId, expectedFirstId, hC.id]
      );

      // Archive gaps: archive first two habits; only hC (sortOrder 2) remains active
      await prisma.habit.update({ where: { id: expectedSecondId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      await prisma.habit.update({ where: { id: expectedFirstId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      const hD = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Appended after archive" }))).json();
      assert.equal(hD.sortOrder, 3);
      const afterArchiveList = await (await routes.listHabits()).json();
      assert.deepEqual(afterArchiveList.map((h: { id: string }) => h.id), [hC.id, hD.id]);

      // Sparse active maximum: update hD to sortOrder 20
      await prisma.habit.update({ where: { id: hD.id }, data: { sortOrder: 20 } });
      const hE = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Appended after sparse" }))).json();
      assert.equal(hE.sortOrder, 21);
      const afterSparseList = await (await routes.listHabits()).json();
      assert.deepEqual(afterSparseList.map((h: { id: string }) => h.id), [hC.id, hD.id, hE.id]);
    });

    await context.test("lost response to operation A, intervening operation B, replay A's receipt leaves DB in state B; changed payload yields MUTATION_ID_CONFLICT", async () => {
      await prisma.habitCheckIn.deleteMany();
      await prisma.habit.deleteMany();
      await prisma.mutationReceipt.deleteMany();

      const h1 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Replay 1" }))).json();
      const h2 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Replay 2" }))).json();
      const h3 = await (await routes.createHabit(jsonRequest("/api/habits", "POST", { name: "Replay 3" }))).json();

      // Op A: reorder to [h2, h3, h1] with mutation ID "op-A-mut"
      const opA = await routes.reorderHabits(
        jsonRequest(
          "/api/habits",
          "PATCH",
          { ids: [h2.id, h3.id, h1.id], expectedIds: [h1.id, h2.id, h3.id] },
          "op-A-mut"
        )
      );
      assert.equal(opA.status, 200);
      assert.deepEqual(await opA.json(), { ids: [h2.id, h3.id, h1.id] });

      // Op B: intervening reorder to [h3, h1, h2] with mutation ID "op-B-mut"
      const opB = await routes.reorderHabits(
        jsonRequest(
          "/api/habits",
          "PATCH",
          { ids: [h3.id, h1.id, h2.id], expectedIds: [h2.id, h3.id, h1.id] },
          "op-B-mut"
        )
      );
      assert.equal(opB.status, 200);
      assert.deepEqual(await opB.json(), { ids: [h3.id, h1.id, h2.id] });

      // DB is currently in state B: [h3, h1, h2]
      const dbStateB = await (await routes.listHabits()).json();
      assert.deepEqual(dbStateB.map((h: { id: string }) => h.id), [h3.id, h1.id, h2.id]);

      // Replay of Op A with same mutation ID "op-A-mut" and exact same payload
      const replayA = await routes.reorderHabits(
        jsonRequest(
          "/api/habits",
          "PATCH",
          { ids: [h2.id, h3.id, h1.id], expectedIds: [h1.id, h2.id, h3.id] },
          "op-A-mut"
        )
      );
      assert.equal(replayA.status, 200);
      // Returns cached result of Op A:
      assert.deepEqual(await replayA.json(), { ids: [h2.id, h3.id, h1.id] });

      // BUT database remains in state B: [h3, h1, h2]! Replay does NOT re-apply old order!
      const dbAfterReplay = await (await routes.listHabits()).json();
      assert.deepEqual(dbAfterReplay.map((h: { id: string }) => h.id), [h3.id, h1.id, h2.id]);

      // Changed payload with same mutation ID yields 409 MUTATION_ID_CONFLICT
      const conflictPayload = await routes.reorderHabits(
        jsonRequest(
          "/api/habits",
          "PATCH",
          { ids: [h1.id, h2.id, h3.id], expectedIds: [h3.id, h1.id, h2.id] },
          "op-A-mut"
        )
      );
      assert.equal(conflictPayload.status, 409);
      assert.equal((await conflictPayload.json()).code, "MUTATION_ID_CONFLICT");

      // Reusing mutation ID across endpoints (e.g. PATCH /api/habits on POST /api/habits) yields 409 MUTATION_ID_CONFLICT
      const crossEndpointConflict = await routes.createHabit(
        jsonRequest("/api/habits", "POST", { name: "Cross conflict" }, "op-A-mut")
      );
      assert.equal(crossEndpointConflict.status, 409);
      assert.equal((await crossEndpointConflict.json()).code, "MUTATION_ID_CONFLICT");
    });
  });
});
