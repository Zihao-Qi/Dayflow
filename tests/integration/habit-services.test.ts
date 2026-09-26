import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  archiveHabit,
  createHabit,
  readActiveHabits,
  readCheckIns,
  readHabitCheckIns,
  reorderHabits,
  updateHabit,
  upsertCheckIn
} from "../../src/modules/evidence/services/habits";
import { addDays, startOfLocalDay } from "../../src/shared/kernel/calendar";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (prisma: PrismaClient) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-habit-services-test-"));
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
  const { getPrisma } = await import("../../src/lib/prisma");
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  await run(prisma);
}

const now = new Date("2026-09-14T09:30:00-05:00");
const today = startOfLocalDay(now);
const yesterday = addDays(today, -1);
const week = { start: addDays(today, -7), end: addDays(today, 1) };

function checkIn(date: Date, overrides: Partial<{ done: boolean; amount: number | null; note: string }> = {}) {
  return { date, done: true, amount: null, note: "", ...overrides };
}

test("habit services run headlessly on SQLite", async (context) => {
  await withDatabase(context, async (prisma) => {
    const tx = prisma as unknown as Prisma.TransactionClient;

    await context.test("recording the same day twice updates one row", async () => {
      const habit = await createHabit(tx, {
        name: "Morning stretch", cadence: "DAILY", targetPerWeek: 7
      });
      await upsertCheckIn(tx, habit.id, checkIn(today, { amount: 10 }));
      await upsertCheckIn(tx, habit.id, checkIn(today, { amount: 20, note: "longer" }));

      const rows = await readHabitCheckIns(tx, habit.id, week);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].amount, 20);
      assert.equal(rows[0].note, "longer");
    });

    await context.test("toggling done preserves existing amount and note when omitted", async () => {
      const habit = await createHabit(tx, {
        name: "Preserve evidence", cadence: "DAILY", targetPerWeek: 7
      });
      await upsertCheckIn(tx, habit.id, { date: today, done: true, amount: 15, note: "before breakfast" });

      // Omit amount and note on toggle
      await upsertCheckIn(tx, habit.id, { date: today, done: false });

      const rows = await readHabitCheckIns(tx, habit.id, week);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].done, false);
      assert.equal(rows[0].amount, 15);
      assert.equal(rows[0].note, "before breakfast");

      // Explicit null clears existing evidence
      await upsertCheckIn(tx, habit.id, { date: today, done: false, amount: null, note: null });
      const clearedRows = await readHabitCheckIns(tx, habit.id, week);
      assert.equal(clearedRows.length, 1);
      assert.equal(clearedRows[0].amount, null);
      assert.equal(clearedRows[0].note, null);
    });

    await context.test("one Check-in per Habit per day survives a concurrent race", async () => {
      const habit = await createHabit(tx, {
        name: "Race", cadence: "DAILY", targetPerWeek: 7
      });
      // The unique index, not the caller, is what makes this hold.
      const results = await Promise.allSettled([
        upsertCheckIn(tx, habit.id, checkIn(today, { amount: 1 })),
        upsertCheckIn(tx, habit.id, checkIn(today, { amount: 2 }))
      ]);
      assert.ok(
        results.some((result) => result.status === "fulfilled"),
        "at least one concurrent Check-in must commit"
      );
      assert.equal((await readHabitCheckIns(tx, habit.id, week)).length, 1);
    });

    await context.test(
      "a second row for the same Habit and day is refused by the database",
      async () => {
        // The upsert above cannot prove this on its own: if the unique index
        // were missing it would simply write two rows. Going around the ORM
        // shows the constraint is real.
        const habit = await createHabit(tx, {
          name: "Invariant", cadence: "DAILY", targetPerWeek: 7
        });
        await upsertCheckIn(tx, habit.id, checkIn(today));
        await assert.rejects(
          prisma.$executeRawUnsafe(
            `INSERT INTO "HabitCheckIn"
               ("id", "habitId", "date", "done", "amount", "note", "createdAt", "updatedAt")
             VALUES ('duplicate-check-in', '${habit.id}', ${today.getTime()}, 1, NULL, '', ${today.getTime()}, ${today.getTime()});`
          ),
          /UNIQUE constraint failed/
        );
        assert.equal((await readHabitCheckIns(tx, habit.id, week)).length, 1);
      }
    );

    await context.test("the unique day is per Habit, not per day", async () => {
      const first = await createHabit(tx, { name: "Read", cadence: "DAILY", targetPerWeek: 7 });
      const second = await createHabit(tx, { name: "Walk", cadence: "DAILY", targetPerWeek: 7 });
      await upsertCheckIn(tx, first.id, checkIn(yesterday));
      await upsertCheckIn(tx, second.id, checkIn(yesterday));

      assert.equal((await readHabitCheckIns(tx, first.id, week)).length, 1);
      assert.equal((await readHabitCheckIns(tx, second.id, week)).length, 1);
    });

    await context.test(
      "an unrecorded day and an explicit not-done are different records",
      async () => {
        // A read model may choose to present both as a miss, but it must be
        // able to tell them apart; this is the whole reason absence is not
        // stored as failure.
        const habit = await createHabit(tx, {
          name: "Distinguish", cadence: "DAILY", targetPerWeek: 7
        });
        await upsertCheckIn(tx, habit.id, checkIn(today, { done: false }));

        const rows = await readHabitCheckIns(tx, habit.id, week);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].done, false);
        assert.equal(rows[0].date.getTime(), today.getTime());
        // Yesterday was never recorded, so it has no row at all.
        assert.equal(
          rows.some((row) => row.date.getTime() === yesterday.getTime()),
          false
        );
      }
    );

    await context.test("a target-only patch keeps a daily Habit at seven", async () => {
      // The parser cannot normalise this: the patch carries no cadence, so
      // only the stored row knows the Habit is daily.
      const habit = await createHabit(tx, {
        name: "Stays daily", cadence: "DAILY", targetPerWeek: 7
      });
      const updated = await updateHabit(tx, habit.id, { targetPerWeek: 1 });
      assert.equal(updated.cadence, "DAILY");
      assert.equal(updated.targetPerWeek, 7);
    });

    await context.test("a target-only patch is honoured for a times-per-week Habit", async () => {
      // The control for the case above: normalising everything would break this.
      const habit = await createHabit(tx, {
        name: "Stays weekly", cadence: "TIMES_PER_WEEK", targetPerWeek: 5
      });
      const updated = await updateHabit(tx, habit.id, { targetPerWeek: 2 });
      assert.equal(updated.targetPerWeek, 2);
    });

    await context.test("archiving twice keeps the first timestamp", async () => {
      // readHabitsActiveDuring decides which past periods contain a Habit from
      // archivedAt, so moving it would resurrect a Habit in reviews it left.
      const habit = await createHabit(tx, {
        name: "Archive twice", cadence: "DAILY", targetPerWeek: 7
      });
      const first = await archiveHabit(tx, habit.id, now);
      const later = new Date(now.getTime() + 86_400_000);
      const second = await archiveHabit(tx, habit.id, later);
      assert.equal(second.archivedAt?.getTime(), first.archivedAt?.getTime());
      assert.notEqual(second.archivedAt?.getTime(), later.getTime());
    });

    await context.test("archiving keeps every Check-in and hides the Habit", async () => {
      const habit = await createHabit(tx, {
        name: "Archive me", cadence: "TIMES_PER_WEEK", targetPerWeek: 3
      });
      await upsertCheckIn(tx, habit.id, checkIn(yesterday, { note: "kept" }));

      const archived = await archiveHabit(tx, habit.id, now);
      assert.equal(archived.status, "ARCHIVED");
      assert.equal(archived.archivedAt?.getTime(), now.getTime());

      const rows = await readHabitCheckIns(tx, habit.id, week);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].note, "kept");

      const active = await readActiveHabits(tx);
      assert.equal(active.some((entry) => entry.id === habit.id), false);
    });

    await context.test("the range read returns every Habit's Check-ins in day order", async () => {
      const rows = await readCheckIns(tx, week);
      const ordered = [...rows].sort((left, right) => left.date.getTime() - right.date.getTime());
      assert.deepEqual(rows.map((row) => row.id), ordered.map((row) => row.id));
      assert.ok(rows.length >= 2);
    });

    await context.test("reordering updates sortOrder and subsequent creates append", async () => {
      const h1 = await createHabit(tx, { name: "First", cadence: "DAILY", targetPerWeek: 7 });
      const h2 = await createHabit(tx, { name: "Second", cadence: "DAILY", targetPerWeek: 7 });
      const h3 = await createHabit(tx, { name: "Third", cadence: "DAILY", targetPerWeek: 7 });

      const initial = await readActiveHabits(tx);
      const currentIds = initial.map((h) => h.id);
      const targetIds = [
        ...currentIds.filter((id) => id !== h1.id && id !== h2.id && id !== h3.id),
        h3.id,
        h1.id,
        h2.id
      ];
      await reorderHabits(tx, targetIds, currentIds);

      const afterReorder = await readActiveHabits(tx);
      assert.deepEqual(afterReorder.slice(-3).map((h) => h.id), [h3.id, h1.id, h2.id]);

      const h4 = await createHabit(tx, { name: "Fourth", cadence: "DAILY", targetPerWeek: 7 });
      const afterAppend = await readActiveHabits(tx);
      assert.equal(afterAppend[afterAppend.length - 1].id, h4.id);
    });
  });
});
