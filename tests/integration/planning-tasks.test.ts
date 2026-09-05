import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { isTaskRecord, parseTaskCreateMutation, parseTaskPatchInput, taskErrors } from "../../src/modules/planning/domain/task";
import { focusQueueErrors } from "../../src/modules/planning/domain/focus-queue";
import { createTask, updateTask, deleteTask, reorderTasks, undoSchedule, readTask, readDayTasks } from "../../src/modules/planning/services/tasks";
import { listFocusQueue, addToFocusQueue, reorderFocusQueue, removeFromFocusQueue, consumeFocusQueueTask, compactFocusQueue } from "../../src/modules/planning/services/focus-queue";
import { AppError } from "../../src/shared/kernel/errors";
import { calendarFor, frozenClock } from "../../src/shared/kernel/calendar";
import { projectErrors } from "../../src/lib/project-errors";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-planning-tasks-test-"));
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
const calendar = calendarFor("America/Chicago");
const draft = (changes: Record<string, unknown> = {}) =>
  parseTaskCreateMutation({ title: "  Task snapshot  ", date: "2026-09-04", ...changes }, clock.now());
const patch = (changes: Record<string, unknown>) => parseTaskPatchInput(changes, clock.now());
function hasSpec(spec: AppError["spec"]) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.deepEqual(error.spec, spec);
    return true;
  };
}

test("planning Task and focus-queue services run headlessly on SQLite", async (context) => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const create = (changes: Record<string, unknown> = {}) =>
      prisma.$transaction((tx) => createTask(tx, draft(changes)));
    const update = (id: string, changes: Record<string, unknown>) =>
      prisma.$transaction((tx) => updateTask(tx, id, patch(changes), calendar, clock.now()));
    const reset = async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.task.deleteMany();
      await prisma.project.deleteMany();
    };

    await context.test("create with placement returns the complete DTO and appends within its date", async () => {
      const project = await prisma.project.create({ data: { name: "Project" } });
      const phase = await prisma.projectPhase.create({ data: { projectId: project.id, name: "Phase" } });
      const first = await create({ projectId: project.id, phaseId: phase.id });
      const second = await create();
      assert.ok(isTaskRecord(first));
      assert.equal(first.title, "Task snapshot");
      assert.equal(first.projectId, project.id);
      assert.equal(first.phaseId, phase.id);
      assert.equal(first.sortOrder, 1);
      assert.equal(second.sortOrder, 2);
      assert.deepEqual(await readTask(prisma, first.id), first);
      const tomorrow = calendar.startOf(calendar.addDays(calendar.dayOf(clock.now()), 1));
      assert.deepEqual(await readDayTasks(prisma, { start: draft().date!, end: tomorrow }), [first, second]);
      assert.deepEqual(first, JSON.parse(JSON.stringify(await prisma.task.findUniqueOrThrow({ where: { id: first.id } }))));
      await reset();
    });

    await context.test("date changes record history; DONE consumes and compacts the queue; undo restores the date", async () => {
      const first = await create();
      const second = await create();
      await prisma.$transaction(async (tx) => {
        await addToFocusQueue(tx, first.id, "end");
        await addToFocusQueue(tx, second.id, "end");
      });
      const updated = await update(first.id, { date: "2026-09-05", status: "DONE", scheduleSource: "drag" });
      assert.equal(updated.completedAt, clock.now().toISOString());
      assert.equal(updated.focusQueuePosition, null);
      const changes = await prisma.taskScheduleChange.findMany({ where: { taskId: first.id } });
      assert.equal(changes.length, 1);
      assert.equal(changes[0].previousDate?.toISOString(), first.date);
      assert.equal(changes[0].nextDate?.toISOString(), updated.date);
      assert.equal(changes[0].source, "drag");
      const queue = await listFocusQueue(prisma);
      assert.deepEqual(queue.map((task) => [task.id, task.focusQueuePosition]), [[second.id, 0]]);
      const undone = await prisma.$transaction((tx) => undoSchedule(tx, first.id));
      assert.equal(undone.date, first.date);
      assert.equal(undone.status, "DONE");
      assert.equal(await prisma.taskScheduleChange.count(), 0);
      await update(first.id, { title: "No schedule change" });
      assert.equal(await prisma.taskScheduleChange.count(), 0);
      await reset();
    });

    await context.test("missing project, phase mismatch, and completed project reject create/update with rollback", async () => {
      const project = await prisma.project.create({ data: { name: "Original" } });
      const other = await prisma.project.create({ data: { name: "Other" } });
      const completed = await prisma.project.create({ data: { name: "Completed", status: "COMPLETED" } });
      const phase = await prisma.projectPhase.create({ data: { projectId: project.id, name: "Phase" } });
      const task = await create({ projectId: project.id, phaseId: phase.id });
      await prisma.$transaction((tx) => addToFocusQueue(tx, task.id, "end"));
      const original = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      for (const [placement, spec] of [
        [{ projectId: "missing" }, projectErrors.theSelectedProjectCouldNotBeFound],
        [{ projectId: other.id, phaseId: phase.id }, projectErrors.theSelectedPhaseDoesNotBelongToThisProject],
        [{ projectId: completed.id }, projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork]
      ] as const) {
        await assert.rejects(() => create(placement), hasSpec(spec));
        await assert.rejects(() => update(task.id, { ...placement, date: null, title: "Lost" }), hasSpec(spec));
        assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), original);
        assert.equal(await prisma.task.count(), 1);
        assert.equal(await prisma.taskScheduleChange.count(), 0);
      }
      const moved = await update(task.id, { projectId: other.id });
      assert.equal(moved.phaseId, null);
      const done = await create({ projectId: completed.id, status: "DONE" });
      assert.equal(done.status, "DONE");
      await reset();
    });

    await context.test("reorder preserves requested order and a P2025 race rolls back preceding writes", async () => {
      const first = await create();
      const second = await create();
      const ordered = await prisma.$transaction((tx) => reorderTasks(tx, [second.id, first.id]));
      assert.deepEqual(ordered.map((task) => [task.id, task.sortOrder]), [[second.id, 1], [first.id, 2]]);
      await assert.rejects(() => prisma.$transaction((tx) => reorderTasks(tx, [first.id, "missing"])), hasSpec(taskErrors.oneOrMoreTasksCouldNotBeFound));
      await prisma.$executeRawUnsafe(`CREATE TRIGGER disappear_before_task_reorder BEFORE UPDATE ON "Task"
        WHEN OLD.id = '${second.id}' BEGIN DELETE FROM "Task" WHERE id = OLD.id; END;`);
      try {
        await assert.rejects(() => prisma.$transaction((tx) => reorderTasks(tx, [first.id, second.id])), hasSpec(taskErrors.aTaskChangedBeforeItsOrderCouldBeSaved));
        assert.equal((await readTask(prisma, first.id))?.sortOrder, 2);
        assert.equal((await readTask(prisma, second.id))?.sortOrder, 1);
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER disappear_before_task_reorder");
      }
      await reset();
    });

    await context.test("undo missing records and a P2025 race preserve history and the task", async () => {
      await assert.rejects(() => prisma.$transaction((tx) => undoSchedule(tx, "missing")), hasSpec(taskErrors.taskNotFoundidNOTFOUND));
      const task = await create();
      await assert.rejects(() => prisma.$transaction((tx) => undoSchedule(tx, task.id)), hasSpec(taskErrors.thereIsNoScheduleChangeToUndo));
      const updated = await update(task.id, { date: null });
      await prisma.$executeRawUnsafe(`CREATE TRIGGER disappear_before_task_undo BEFORE UPDATE ON "Task"
        BEGIN DELETE FROM "Task" WHERE id = OLD.id; END;`);
      try {
        await assert.rejects(() => prisma.$transaction((tx) => undoSchedule(tx, task.id)), hasSpec(taskErrors.theScheduleChangedBeforeItCouldBeUndone));
        assert.deepEqual(await readTask(prisma, task.id), updated);
        assert.equal(await prisma.taskScheduleChange.count(), 1);
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER disappear_before_task_undo");
      }
      await reset();
    });

    await context.test("queue add, move, reorder, remove, consume and compact preserve contiguous positions", async () => {
      const a = await create(); const b = await create(); const c = await create();
      const queue = await prisma.$transaction(async (tx) => {
        await addToFocusQueue(tx, a.id, "end");
        await addToFocusQueue(tx, b.id, "next");
        await addToFocusQueue(tx, c.id, "end");
        return addToFocusQueue(tx, a.id, "next");
      });
      assert.deepEqual(queue.map((task) => task.id), [a.id, b.id, c.id]);
      await assert.rejects(() => prisma.$transaction((tx) => reorderFocusQueue(tx, [c.id, b.id, a.id], [b.id, a.id, c.id])), hasSpec(focusQueueErrors.queueOrderIsOutOfDateRefreshAndTryAgain));
      assert.deepEqual(await listFocusQueue(prisma), queue);
      const reordered = await prisma.$transaction((tx) => reorderFocusQueue(tx, [c.id, b.id, a.id], [a.id, b.id, c.id]));
      assert.deepEqual(reordered.map((task) => task.id), [c.id, b.id, a.id]);
      const removed = await prisma.$transaction((tx) => removeFromFocusQueue(tx, b.id));
      assert.deepEqual(removed.map((task) => [task.id, task.focusQueuePosition]), [[c.id, 0], [a.id, 1]]);
      assert.deepEqual(await prisma.$transaction((tx) => removeFromFocusQueue(tx, "missing")), removed);
      await prisma.task.update({ where: { id: a.id }, data: { focusQueuePosition: 9 } });
      await prisma.$transaction((tx) => compactFocusQueue(tx));
      assert.equal((await readTask(prisma, a.id))?.focusQueuePosition, 1);
      await prisma.$transaction((tx) => consumeFocusQueueTask(tx, c.id));
      assert.equal((await readTask(prisma, a.id))?.focusQueuePosition, 0);
      await prisma.$transaction((tx) => consumeFocusQueueTask(tx, "missing"));
      const done = await create({ status: "DONE" });
      await assert.rejects(() => prisma.$transaction((tx) => addToFocusQueue(tx, done.id, "end")), hasSpec(focusQueueErrors.completedTasksCannotBeQueued));
      await assert.rejects(() => prisma.$transaction((tx) => addToFocusQueue(tx, "missing", "end")), hasSpec(focusQueueErrors.taskNotFound));
      assert.deepEqual(await prisma.$transaction((tx) => deleteTask(tx, a.id)), { ok: true });
      assert.deepEqual(await listFocusQueue(prisma), []);
      await assert.rejects(() => prisma.$transaction((tx) => deleteTask(tx, a.id)), hasSpec(taskErrors.taskNotFound));
      await assert.rejects(() => update(a.id, {}), hasSpec(taskErrors.taskNotFound));
      await reset();
    });

    await context.test("schedule history failure rolls back Task and queue writes", async () => {
      const a = await create(); const b = await create();
      await prisma.$transaction(async (tx) => { await addToFocusQueue(tx, a.id, "end"); await addToFocusQueue(tx, b.id, "end"); });
      const original = await listFocusQueue(prisma);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_task_schedule BEFORE INSERT ON "TaskScheduleChange"
        BEGIN SELECT RAISE(ABORT, 'history unavailable'); END;`);
      try {
        await assert.rejects(() => update(a.id, { date: null, status: "DONE" }));
        assert.deepEqual(await listFocusQueue(prisma), original);
        assert.equal(await prisma.taskScheduleChange.count(), 0);
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_task_schedule"); }
      await reset();
    });

    await context.test("runOnce recovers a real P2002 receipt race and rolls back the losing Task", async () => {
      const { mutationRequestHash } = await import("../../src/server/prisma/run-once");
      const payload = { title: "Receipt race" };
      const winner = await create(payload);
      await prisma.mutationReceipt.create({ data: {
        id: "task-receipt-race", kind: "task.create",
        requestHash: mutationRequestHash("task.create", payload), responseJson: JSON.stringify(winner)
      } });
      const originalTransaction = prisma.$transaction;
      let staleReads = 0;
      let creates = 0;
      let failureCode: string | undefined;
      // Deterministically hide the committed winner only from the transaction's
      // initial lookup. SQLite itself raises P2002 at receipt insertion; the
      // recovery lookup sees the real committed receipt after rollback.
      prisma.$transaction = (async (operation: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<unknown>) => {
        try {
          return await originalTransaction.call(prisma, async (tx) => operation(new Proxy(tx, {
            get(target, property) {
              if (property !== "mutationReceipt") return Reflect.get(target, property);
              return new Proxy(target.mutationReceipt, {
                get(delegate, method) {
                  if (method === "findUnique") return async () => { staleReads++; return null; };
                  return Reflect.get(delegate, method);
                }
              });
            }
          })));
        } catch (error) {
          if (error instanceof Error && "code" in error) failureCode = String(error.code);
          throw error;
        }
      }) as typeof prisma.$transaction;
      try {
        const recovered = await runOnce({
          mutationId: "task-receipt-race", kind: "task.create", payload,
          create: (tx) => { creates++; return createTask(tx, draft(payload)); }
        });
        assert.deepEqual(recovered, winner);
        assert.equal(failureCode, "P2002");
        assert.equal(staleReads, 1);
        assert.equal(creates, 1);
        assert.equal(await prisma.task.count(), 1);
        assert.equal(await prisma.mutationReceipt.count(), 1);
        assert.deepEqual(await readTask(prisma, winner.id), winner);
      } finally {
        prisma.$transaction = originalTransaction;
      }
      await reset();
    });

    await context.test("runOnce replays the stored receipt DTO after the source Task is changed and deleted", async () => {
      let calls = 0;
      const payload = { title: "Original receipt Task" };
      const options = {
        mutationId: "task-replay-after-source-change", kind: "task.create", payload,
        create: (tx: import("@prisma/client").Prisma.TransactionClient) => {
          calls++;
          return createTask(tx, draft(payload));
        }
      };
      const first = await runOnce(options);
      const receipt = await prisma.mutationReceipt.findUniqueOrThrow({ where: { id: options.mutationId } });
      assert.deepEqual(JSON.parse(receipt.responseJson), first);

      await prisma.task.update({ where: { id: first.id }, data: { title: "Changed source Task" } });
      assert.equal((await readTask(prisma, first.id))?.title, "Changed source Task");
      assert.deepEqual(await runOnce(options), first);
      assert.equal(calls, 1);
      assert.equal((await readTask(prisma, first.id))?.title, "Changed source Task");

      await prisma.task.delete({ where: { id: first.id } });
      assert.deepEqual(await runOnce(options), first);
      assert.equal(calls, 1);
      assert.equal(await prisma.task.count(), 0);
      assert.equal(await prisma.mutationReceipt.count(), 1);
      assert.deepEqual(await prisma.mutationReceipt.findUniqueOrThrow({ where: { id: options.mutationId } }), receipt);
      await reset();
    });

    await context.test("runOnce replays its DTO, rejects receipt mismatch and rolls back receipt failure", async () => {
      let calls = 0;
      const options = { mutationId: "task-replay", kind: "task.create", payload: { title: "Task" },
        create: (tx: import("@prisma/client").Prisma.TransactionClient) => { calls++; return createTask(tx, draft()); } };
      const first = await runOnce(options);
      assert.deepEqual(await runOnce(options), first);
      assert.equal(calls, 1);
      assert.equal(await prisma.task.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
      await assert.rejects(() => runOnce({ ...options, payload: { title: "Different" } }), (error: unknown) => error instanceof AppError && error.code === "MUTATION_ID_CONFLICT");
      assert.equal(calls, 1);
      await reset();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_task_receipt BEFORE INSERT ON "MutationReceipt"
        BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
      try {
        await assert.rejects(() => runOnce(options));
        assert.equal(await prisma.task.count(), 0);
        assert.equal(await prisma.mutationReceipt.count(), 0);
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_task_receipt"); }
    });
  });
});
