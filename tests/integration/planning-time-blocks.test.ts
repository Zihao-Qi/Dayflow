import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import {
  isTimeBlockRecord,
  parseTimeBlockDraftStructure,
  timeBlockErrors
} from "../../src/modules/planning/domain/time-block";
import {
  createTimeBlock,
  deleteTimeBlock,
  readTimeBlocks,
  replaceTimeBlock
} from "../../src/modules/planning/services/time-blocks";
import { AppError } from "../../src/shared/kernel/errors";
import { frozenClock } from "../../src/shared/kernel/calendar";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-planning-time-blocks-test-"));
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
  // Load the transaction root only after directing its client at disposable SQLite.
  const [{ prisma }, { runOnce }] = await Promise.all([
    import("../../src/lib/prisma"),
    import("../../src/server/prisma/run-once")
  ]);
  disconnect = () => prisma.$disconnect();
  await run({ prisma, runOnce });
}

const clock = frozenClock(new Date("2026-09-04T12:00:00-05:00"));
const body = {
  date: "2026-09-04", startTime: "09:00", endTime: "10:00",
  title: "  Original title snapshot  ", taskId: null
};
const draft = (changes: Record<string, unknown> = {}) =>
  parseTimeBlockDraftStructure({ ...body, ...changes });

function hasSpec(spec: AppError["spec"]) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.deepEqual(error.spec, spec);
    return true;
  };
}

test("planning Time Block services run headlessly on SQLite", async (context) => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const create = (changes: Record<string, unknown> = {}) =>
      prisma.$transaction((tx) => createTimeBlock(tx, draft(changes), clock.now()));
    const reset = async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.timeBlock.deleteMany();
      await prisma.task.deleteMany();
    };

    await context.test("create commits a decoded DTO and preserves its title snapshot", async () => {
      const task = await prisma.task.create({
        data: { title: "Linked Task", date: draft().date, estimateMinutes: 45 }
      });
      const block = await create({ taskId: task.id });
      assert.ok(isTimeBlockRecord(block));
      assert.equal(block.title, "Original title snapshot");
      assert.deepEqual(block.task, { id: task.id, title: "Linked Task", estimateMinutes: 45 });
      assert.equal(await prisma.timeBlock.count(), 1);
      await prisma.task.update({ where: { id: task.id }, data: { title: "Renamed Task" } });
      const range = { start: draft().date, end: draft({ date: "2026-09-05" }).date };
      for (const scope of ["day", "range"] as const) {
        const [read] = await readTimeBlocks(prisma, range, scope);
        assert.equal(read.title, "Original title snapshot");
        assert.equal(read.task?.title, "Renamed Task");
        assert.ok(isTimeBlockRecord(read));
      }
      await reset();
    });

    await context.test("overlap rejects atomically while both adjacent endpoints are allowed", async () => {
      const original = await create();
      await assert.rejects(() => create({ startTime: "09:30", endTime: "10:30" }),
        hasSpec({ status: 409, message: 'This Time Block overlaps "Original title snapshot" at 09:00–10:00.',
          code: "TIME_BLOCK_OVERLAP", field: "startTime" }));
      assert.equal(await prisma.timeBlock.count(), 1);
      await create({ startTime: "08:00", endTime: "09:00" });
      await create({ startTime: "10:00", endTime: "11:00" });
      const rows = await readTimeBlocks(prisma, {
        start: draft().date, end: draft({ date: "2026-09-05" }).date
      }, "day");
      assert.deepEqual(rows.map((row) => row.startTime), ["08:00", "09:00", "10:00"]);
      assert.equal(rows[1].id, original.id);
      await reset();
    });

    await context.test("replace excludes itself and rolls back an overlapping replacement", async () => {
      const block = await create();
      await create({ startTime: "11:00", endTime: "12:00", title: "Neighbor" });
      const replace = (changes: Record<string, unknown>) => prisma.$transaction((tx) =>
        replaceTimeBlock(tx, block.id, draft(changes), clock));
      const updated = await replace({ title: "Updated snapshot", endTime: "10:30" });
      assert.equal(updated.id, block.id);
      assert.equal(updated.createdAt, block.createdAt);
      assert.equal(updated.title, "Updated snapshot");
      const stored = await prisma.timeBlock.findUniqueOrThrow({ where: { id: block.id } });
      await assert.rejects(() => replace({ endTime: "11:30" }),
        (error: unknown) => error instanceof AppError && error.code === "TIME_BLOCK_OVERLAP");
      assert.deepEqual(await prisma.timeBlock.findUniqueOrThrow({ where: { id: block.id } }), stored);
      await reset();
    });

    await context.test("past-day creation is refused but an unchanged past block remains correctable", async () => {
      await assert.rejects(() => create({ date: "2026-09-03" }),
        hasSpec(timeBlockErrors.timeBlocksCannotBePlannedForADayThatHasAlready));
      const block = await create();
      const tomorrow = frozenClock(new Date("2026-09-05T12:00:00-05:00"));
      const corrected = await prisma.$transaction((tx) =>
        replaceTimeBlock(tx, block.id, draft({ title: "Past correction" }), tomorrow));
      assert.equal(corrected.title, "Past correction");
      await assert.rejects(() => prisma.$transaction((tx) =>
        replaceTimeBlock(tx, block.id, draft({ date: "2026-09-03" }), tomorrow)),
      hasSpec(timeBlockErrors.timeBlocksCannotBePlannedForADayThatHasAlready));
      await reset();
    });

    await context.test("new Task links require the same day and unfinished status; retained links survive", async () => {
      await assert.rejects(() => create({ taskId: "missing-task" }),
        hasSpec(timeBlockErrors.theSelectedTaskCouldNotBeFound));
      const task = await prisma.task.create({ data: { title: "Scheduled", date: draft().date } });
      const block = await create({ taskId: task.id });
      await prisma.task.update({ where: { id: task.id }, data: { status: "DONE", date: null } });
      await assert.rejects(() => create({ taskId: task.id, startTime: "10:00", endTime: "11:00" }),
        hasSpec(timeBlockErrors.chooseAnUnfinishedTaskScheduledForTheSameDayAsThe));
      const updated = await prisma.$transaction((tx) =>
        replaceTimeBlock(tx, block.id, draft({ taskId: task.id }), clock));
      assert.equal(updated.taskId, task.id);
      assert.equal(updated.title, "Original title snapshot");
      await reset();
    });

    await context.test("delete commits and missing delete/replace throw the boundary catalog", async () => {
      const block = await create();
      assert.deepEqual(await prisma.$transaction((tx) => deleteTimeBlock(tx, block.id)),
        { ok: true, id: block.id });
      assert.equal(await prisma.timeBlock.count(), 0);
      await assert.rejects(() => prisma.$transaction((tx) => deleteTimeBlock(tx, block.id)),
        hasSpec(timeBlockErrors.timeBlockNotFound));
      await assert.rejects(() => prisma.$transaction((tx) =>
        replaceTimeBlock(tx, block.id, draft(), clock)), hasSpec(timeBlockErrors.timeBlockNotFound));
    });

    await context.test("a seeded P2025 update race translates locally and rolls back the trigger", async () => {
      const block = await create();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER disappear_before_time_block_update
        BEFORE UPDATE ON "TimeBlock" BEGIN DELETE FROM "TimeBlock" WHERE id = OLD.id; END;`);
      try {
        await assert.rejects(() => prisma.$transaction((tx) =>
          replaceTimeBlock(tx, block.id, draft({ title: "Lost" }), clock)),
        hasSpec(timeBlockErrors.timeBlockNotFound));
        assert.equal((await prisma.timeBlock.findUniqueOrThrow({ where: { id: block.id } })).title,
          block.title);
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER disappear_before_time_block_update");
      }
      await reset();
    });

    await context.test("a seeded P2003 create race translates locally and restores the Task", async () => {
      const task = await prisma.task.create({ data: { title: "Racing Task", date: draft().date } });
      await prisma.$executeRawUnsafe(`CREATE TRIGGER unlink_before_time_block_create
        BEFORE INSERT ON "TimeBlock" BEGIN DELETE FROM "Task" WHERE id = NEW.taskId; END;`);
      try {
        await assert.rejects(() => create({ taskId: task.id }),
          hasSpec(timeBlockErrors.theSelectedTaskCouldNotBeFound));
        assert.equal(await prisma.timeBlock.count(), 0);
        assert.equal(await prisma.task.count({ where: { id: task.id } }), 1);
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER unlink_before_time_block_create");
      }
      await reset();
    });

    await context.test("runOnce replays its stored DTO after midnight without rerunning the service", async () => {
      let calls = 0;
      const options = {
        mutationId: "planning-create-replay", kind: "time-block.create", payload: body,
        create: (tx: import("@prisma/client").Prisma.TransactionClient) => {
          calls += 1;
          return createTimeBlock(tx, draft(), clock.now());
        }
      };
      const first = await runOnce(options);
      const replay = await runOnce({ ...options, create: (tx) => {
        calls += 1;
        return createTimeBlock(tx, draft(), new Date("2026-09-05T12:00:00-05:00"));
      } });
      assert.deepEqual(replay, first);
      assert.equal(calls, 1);
      assert.equal(await prisma.timeBlock.count(), 1);
      const receipt = await prisma.mutationReceipt.findUniqueOrThrow({ where: { id: options.mutationId } });
      assert.deepEqual(JSON.parse(receipt.responseJson), first);
      assert.equal(await prisma.mutationReceipt.count(), 1);
      await assert.rejects(() => runOnce({ ...options, payload: { ...body, title: "Different" } }),
        (error: unknown) => error instanceof AppError && error.code === "MUTATION_ID_CONFLICT");
      assert.equal(calls, 1);
      await reset();
    });

    await context.test("receipt insertion failure rolls back the service write", async () => {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_planning_receipt
        BEFORE INSERT ON "MutationReceipt" BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
      try {
        await assert.rejects(() => runOnce({
          mutationId: "planning-create-rollback", kind: "time-block.create", payload: body,
          create: (tx) => createTimeBlock(tx, draft(), clock.now())
        }));
        assert.equal(await prisma.timeBlock.count(), 0);
        assert.equal(await prisma.mutationReceipt.count(), 0);
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER reject_planning_receipt");
      }
    });
  });
});
