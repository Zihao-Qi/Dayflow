import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { readSnapshot, startSession, transitionSession, enrichSession } from "../../src/modules/focus/services/sessions";
import { focusErrors, parseFocusSessionStartMutation } from "../../src/modules/focus/domain/session";
import { AppError } from "../../src/shared/kernel/errors";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-focus-services-test-"));
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
  const [{ getPrisma }, { runOnce }] = await Promise.all([
    import("../../src/lib/prisma"),
    import("../../src/server/prisma/run-once")
  ]);
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  await run({ prisma, runOnce });
}

const now = new Date("2026-09-04T12:00:00-05:00");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

test("focus services run headlessly on SQLite", async context => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const start = (input = {}) => prisma.$transaction(tx => startSession(tx, { plannedMinutes: 25, ...input }, now));
    const complete = (id: string, at = later(180)) => prisma.$transaction(tx => transitionSession(tx, id, "complete", at));
    const reset = async () => {
      await prisma.activityEntry.deleteMany();
      await prisma.focusSession.deleteMany();
      await prisma.mutationReceipt.deleteMany();
      await prisma.task.deleteMany();
    };

    await context.test("rollback when the evidence write fails leaves the session un-completed", async () => {
      const session = await start();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_focus_evidence BEFORE INSERT ON "ActivityEntry" BEGIN SELECT RAISE(ABORT, 'evidence unavailable'); END;`);
      try { await assert.rejects(() => complete(session.id)); }
      finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_focus_evidence'); }
      assert.deepEqual(await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id }, include: { task: true, project: true, activity: true } }), session);
      assert.equal(await prisma.activityEntry.count(), 0);
      assert.equal((await readSnapshot(prisma, later(180))).active?.id, session.id);
      await reset();
    });

    await context.test("two concurrent completions yield exactly one Activity via the unique focusSessionId", async () => {
      const task = await prisma.task.create({ data: { title: "Still unfinished" } });
      const session = await start({ taskId: task.id });
      const results = await Promise.all([complete(session.id), complete(session.id)]);
      assert.ok(results.every(result => result.completed));
      assert.deepEqual(results[0], results[1]);
      const activities = await prisma.activityEntry.findMany({ where: { focusSessionId: session.id } });
      assert.equal(activities.length, 1);
      assert.equal(activities[0].origin, "FOCUS");
      assert.equal(activities[0].durationMinutes, 3);
      assert.equal(activities[0].note, "Still unfinished");
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, "TODO");
      assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } })).status, "COMPLETED");
      assert.deepEqual(await complete(session.id, later(600)), results[0]);
      assert.equal(await prisma.activityEntry.count(), 1);
      await reset();
    });

    await context.test("receipt replay of a start returns the stored response", async () => {
      const input = parseFocusSessionStartMutation({ plannedMinutes: 25, label: "Stored start" });
      const options = { mutationId: "focus-service-start", kind: "focus-session.start", payload: input,
        create: async (tx: Prisma.TransactionClient) => ({ session: await startSession(tx, input, now), snapshot: await readSnapshot(tx, now) }) };
      const first = await runOnce(options);
      await complete(first.session.id);
      const replay = await runOnce({ ...options, create: async () => { throw new Error("replay must not start again"); } });
      assert.deepEqual(replay, JSON.parse(JSON.stringify(first)));
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
      await reset();
    });

    await context.test("zero-minute focus completes without an Activity", async () => {
      const session = await start();
      const result = await complete(session.id, later(59));
      assert.ok("completedSession" in result);
      assert.equal(result.completed, true);
      assert.equal(result.completedSession?.actualMinutes, 0);
      assert.equal(result.completedSession?.status, "COMPLETED");
      assert.equal(result.completedSession?.needsEnrichment, true);
      assert.equal(result.suggestedBreakMinutes, 5);
      await prisma.$transaction(tx => enrichSession(tx, session.id, { note: "No evidence" }, later(60)));
      assert.equal(await prisma.activityEntry.count(), 0);
      assert.equal((await readSnapshot(prisma, later(60))).today.focusedMinutes, 0);
      await reset();
    });

    await context.test("Break completion records nothing", async () => {
      const session = await start({ kind: "BREAK", plannedMinutes: 5, taskId: "ignored", projectId: "ignored" });
      assert.equal(session.label, "Break");
      assert.equal(session.taskId, null);
      assert.deepEqual(await complete(session.id, later(600)), { completed: true, suggestedBreakMinutes: null, completedSession: null });
      const saved = await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } });
      assert.equal(saved.status, "COMPLETED");
      assert.equal(saved.actualMinutes, 5);
      assert.equal(saved.needsEnrichment, false);
      assert.equal(saved.activeKey, null);
      assert.equal(await prisma.activityEntry.count(), 0);
      assert.deepEqual((await readSnapshot(prisma, later(600))).today, { completedSessions: 0, focusedMinutes: 0 });
      await reset();
    });

    await context.test("start with a queued task consumes and compacts the queue", async () => {
      const task = await prisma.task.create({ data: { title: "Next", focusQueuePosition: 0 } });
      const next = await prisma.task.create({ data: { title: "After", focusQueuePosition: 1 } });
      const session = await start({ taskId: task.id });
      assert.equal(session.label, "Next");
      assert.deepEqual(session.startedAt, now);
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).focusQueuePosition, null);
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: next.id } })).focusQueuePosition, 0);
      await reset();
    });

    await context.test("second start is rejected by the active guard", async () => {
      const session = await start();
      const conflict = (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.deepEqual(error.spec, focusErrors.finishOrCancelTheActiveTimerFirst);
        return true;
      };
      await assert.rejects(() => start({ kind: "BREAK" }), conflict);
      // Hide the preflight result to prove the real unique activeKey is also translated.
      await assert.rejects(() => prisma.$transaction(tx => startSession({ ...tx,
        focusSession: { ...tx.focusSession, findFirst: async () => null }
      } as unknown as Prisma.TransactionClient, { plannedMinutes: 25 }, now)), conflict);
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal((await readSnapshot(prisma, now)).active?.id, session.id);
      await reset();
    });

    await context.test("pause/resume elapsed accounting uses a frozen clock", async () => {
      const session = await start();
      await prisma.$transaction(tx => transitionSession(tx, session.id, "pause", later(90)));
      await prisma.$transaction(tx => transitionSession(tx, session.id, "resume", later(210)));
      await prisma.$transaction(tx => transitionSession(tx, session.id, "pause", later(300)));
      const result = await complete(session.id, later(900));
      assert.ok("completedSession" in result);
      assert.equal(result.completedSession?.accumulatedPauseSeconds, 120);
      assert.equal(result.completedSession?.actualMinutes, 3);
      assert.deepEqual(result.completedSession?.completedAt, later(900));
      assert.equal((await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } })).durationMinutes, 3);
      await reset();
    });

    await context.test("enrichment updates category and note and completes the task when requested", async () => {
      const task = await prisma.task.create({ data: { title: "Explicit completion" } });
      const session = await start({ taskId: task.id });
      await complete(session.id);
      const original = await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } });
      await prisma.task.update({ where: { id: task.id }, data: { focusQueuePosition: 0 } });
      const result = await prisma.$transaction(tx => enrichSession(tx, session.id, { category: " Learning ", note: " Finished ", taskCompleted: true }, later(240)));
      assert.equal(result.activity?.id, original.id);
      assert.equal(result.activity?.category, "Learning");
      assert.equal(result.activity?.note, "Finished");
      assert.equal(result.activity?.durationMinutes, 3);
      const savedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(savedTask.status, "DONE");
      assert.deepEqual(savedTask.completedAt, later(240));
      assert.equal(savedTask.focusQueuePosition, null);
      await prisma.$transaction(tx => enrichSession(tx, session.id, { note: "Again", taskCompleted: true }, later(300)));
      const saved = await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } });
      assert.equal(saved.needsEnrichment, false);
      assert.deepEqual(saved.enrichedAt, later(240));
      assert.deepEqual((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt, later(240));
      assert.equal(await prisma.activityEntry.count(), 1);
      await reset();
    });
  });
});
