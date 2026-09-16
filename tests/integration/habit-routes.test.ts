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
  });
});
