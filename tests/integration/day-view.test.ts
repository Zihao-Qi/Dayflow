import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { addDays, startOfLocalDay } from "../../src/lib/dates";

const repositoryRoot = process.cwd();
const prismaCliPath = join(repositoryRoot, "node_modules", "prisma", "build", "index.js");

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    dayView: typeof import("../../src/lib/day-view");
  }) => Promise<void>
) {
  const dir = mkdtempSync(join(tmpdir(), "dayflow-day-view-test-"));
  const databasePath = join(dir, "dayflow.db");
  const previous = process.env.DATABASE_URL;
  let disconnect: (() => Promise<void>) | null = null;
  process.env.DATABASE_URL = `file:${databasePath.split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnect?.();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", "prisma/init.sql", "--url", process.env.DATABASE_URL],
    { cwd: repositoryRoot, stdio: "pipe" }
  );

  const [dayView, { prisma }] = await Promise.all([
    import("../../src/lib/day-view"),
    import("../../src/lib/prisma")
  ]);
  disconnect = () => prisma.$disconnect();
  await run({ prisma, dayView });
}

test("a future day excludes Activity even when a row exists for it", async (context) => {
  await withDatabase(context, async ({ prisma, dayView }) => {
    const today = startOfLocalDay();
    const future = addDays(today, 3);

    // The API refuses future Activity, so plant one directly: the read must
    // exclude it by the kind of day, not by trusting that none can exist.
    await prisma.activityEntry.create({
      data: {
        startedAt: new Date(future.getTime() + 9 * 60 * 60 * 1000),
        durationMinutes: 30,
        category: "Deep Work",
        note: "should never surface on a future day"
      }
    });
    await prisma.task.create({
      data: { title: "Planned ahead", date: future }
    });

    const day = await dayView.readViewedDay(prisma, future);
    assert.equal(day.kind, "future");
    assert.equal(day.tasks.length, 1, "a future day still shows scheduled Tasks");
    assert.deepEqual(
      day.activities,
      [],
      "a future day must carry no Activity at all"
    );

    // The same row is visible once that day is no longer in the future.
    const asIfThatDay = await dayView.readViewedDay(prisma, future, future);
    assert.equal(asIfThatDay.kind, "today");
    assert.equal(asIfThatDay.activities.length, 1);
  });
});

test("a past day carries its own evidence and nothing from a neighbour", async (context) => {
  await withDatabase(context, async ({ prisma, dayView }) => {
    const today = startOfLocalDay();
    const yesterday = addDays(today, -1);
    const twoDaysAgo = addDays(today, -2);

    for (const [day, note] of [
      [yesterday, "yesterday"],
      [twoDaysAgo, "two days ago"]
    ] as const) {
      await prisma.activityEntry.create({
        data: {
          startedAt: new Date(day.getTime() + 10 * 60 * 60 * 1000),
          durationMinutes: 25,
          category: "Admin",
          note
        }
      });
    }

    const day = await dayView.readViewedDay(prisma, yesterday);
    assert.equal(day.kind, "past");
    assert.deepEqual(day.activities.map((a) => a.note), ["yesterday"]);
  });
});

test("reading a day mutates no stored record", async (context) => {
  await withDatabase(context, async ({ prisma, dayView }) => {
    const today = startOfLocalDay();
    await prisma.task.create({ data: { title: "Untouched", date: today } });
    await prisma.activityEntry.create({
      data: {
        startedAt: new Date(today.getTime() + 8 * 60 * 60 * 1000),
        durationMinutes: 15,
        category: "Learning",
        note: "untouched"
      }
    });

    const snapshot = async () =>
      JSON.stringify({
        tasks: await prisma.task.findMany({ orderBy: { id: "asc" } }),
        activities: await prisma.activityEntry.findMany({ orderBy: { id: "asc" } }),
        blocks: await prisma.timeBlock.findMany({ orderBy: { id: "asc" } })
      });

    const before = await snapshot();
    for (const offset of [-2, -1, 0, 1, 5]) {
      await dayView.readViewedDay(prisma, addDays(today, offset));
    }
    await dayView.earliestRecordedDay(prisma);
    assert.equal(await snapshot(), before, "a day read must not write");
  });
});

test("the earliest recorded day spans Tasks, Activities, and Time Blocks", async (context) => {
  await withDatabase(context, async ({ prisma, dayView }) => {
    const today = startOfLocalDay();
    assert.equal(await dayView.earliestRecordedDay(prisma), null);

    await prisma.task.create({ data: { title: "Older", date: addDays(today, -5) } });
    await prisma.activityEntry.create({
      data: {
        startedAt: addDays(today, -9),
        durationMinutes: 10,
        category: "Rest",
        note: "oldest evidence"
      }
    });
    await prisma.timeBlock.create({
      data: {
        date: addDays(today, -7),
        startTime: "09:00",
        endTime: "10:00",
        title: "Older plan"
      }
    });

    const earliest = await dayView.earliestRecordedDay(prisma);
    const expected = addDays(today, -9);
    assert.equal(
      earliest,
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`
    );
  });
});
