import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { initializeTestDatabase } from "../sqlite-test-helpers";

test("Focus enrichment receipts protect a later reopen and return current reads", async context => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-enrichment-retry-"));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, "dayflow.db")}`;
  let disconnect: (() => Promise<void>) | undefined;
  context.after(async () => {
    try { await disconnect?.(); }
    finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  initializeTestDatabase(process.env.DATABASE_URL);
  const [{ PATCH }, { PATCH: patchTask }, { POST: queueTask }, { POST: startFocus }, { getPrisma }] = await Promise.all([
    import("../../src/app/api/focus-session/[id]/route"),
    import("../../src/app/api/tasks/[id]/route"),
    import("../../src/app/api/focus-queue/route"),
    import("../../src/app/api/focus-session/route"),
    import("../../src/lib/prisma")
  ]);
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  async function seed() {
    await prisma.mutationReceipt.deleteMany();
    await prisma.activityEntry.deleteMany();
    await prisma.focusSession.deleteMany();
    await prisma.task.deleteMany();
    const task = await prisma.task.create({ data: { title: "Work", focusQueuePosition: 0 } });
    const session = await prisma.focusSession.create({ data: {
      kind: "FOCUS", status: "COMPLETED", activeKey: null,
      plannedMinutes: 25, actualMinutes: 25, taskId: task.id,
      startedAt: new Date(), completedAt: new Date(), needsEnrichment: true,
      activity: { create: { startedAt: new Date(), durationMinutes: 25,
        category: "Deep Work", note: "Work", origin: "FOCUS", taskId: task.id } }
    } });
    return { task, session };
  }
  const enrich = (id: string, mutationId: string | null, body: Record<string, unknown>) =>
    PATCH(request(`/api/focus-session/${id}`, "PATCH", body, mutationId), params(id));
  async function reopenAndQueue(id: string) {
    const reopened = await patchTask(request(`/api/tasks/${id}`, "PATCH", { status: "TODO" }), params(id));
    assert.equal(reopened.status, 200);
    const queued = await queueTask(request("/api/focus-queue", "POST", { taskId: id, placement: "end" }));
    assert.equal(queued.status, 200);
  }
  const intent = { note: "Finished", category: "Learning", taskCompleted: true };

  for (const action of ["enrich", "record"]) {
    await context.test(`${action}: lost response replay preserves a later Task and Activity edit`, async () => {
      const { task, session } = await seed();
      const first = await enrich(session.id, "lost-response", { action, ...intent });
      assert.equal(first.status, 200); // Deliberately discard the successful body.
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, "DONE");
      // Await route settlement at each step: this is an intervening write, not a timing guess.
      await reopenAndQueue(task.id);
      const newer = await enrich(session.id, "newer-edit", { action, note: "Later fact", category: "Admin", taskCompleted: false });
      assert.equal(newer.status, 200);
      const timer = await startFocus(request("/api/focus-session", "POST", { kind: "BREAK", plannedMinutes: 5 }));
      assert.equal(timer.status, 201);
      const activeId = (await timer.json()).session.id;
      const before = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      const retry = await enrich(session.id, "lost-response", { action: action === "enrich" ? "record" : "enrich", ...intent });
      assert.equal(retry.status, 200);
      const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(after.status, "TODO", "replaying enrichment must not complete a reopened Task");
      assert.equal(after.completedAt, null);
      assert.equal(after.focusQueuePosition, 0);
      assert.deepEqual(after, before, "receipt replay must not write the Task at all");
      const body = await retry.json();
      assert.equal(body.activity.note, "Later fact", "a write receipt must not return historical Activity as current");
      assert.equal(body.activity.category, "Admin");
      assert.equal(body.snapshot.active.id, activeId, "snapshot must be read after replay, not saved in the receipt");
      const receipt = await prisma.mutationReceipt.findUniqueOrThrow({ where: { id: "lost-response" } });
      const acknowledgment = JSON.parse(receipt.responseJson);
      assert.equal("activity" in acknowledgment, false);
      assert.equal("snapshot" in acknowledgment, false);
      const distinct = await enrich(session.id, "distinct-completion", { action, ...intent });
      assert.equal(distinct.status, 200);
      const completed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(completed.status, "DONE");
      assert.ok(completed.completedAt);
      assert.equal(completed.focusQueuePosition, null);
    });
  }

  await context.test("same ID conflicts for changed payload or session; invalid IDs preserve envelopes", async () => {
    const { session } = await seed();
    assert.equal((await enrich(session.id, "conflict", { action: "enrich", ...intent })).status, 200);
    for (const [id, body] of [
      [session.id, { action: "enrich", ...intent, note: "Changed" }],
      ["another-session", { action: "enrich", ...intent }]
    ] as const) {
      const response = await enrich(id, "conflict", body);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "This mutation identifier was already used for a different request.", code: "MUTATION_ID_CONFLICT" });
    }
    assert.equal(await prisma.mutationReceipt.count(), 1);
    assert.equal((await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } })).note, "Finished");
    const invalid = await enrich(session.id, " ", { action: "record", ...intent });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.", code: "INVALID_MUTATION_ID" });
  });

  await context.test("receipt insertion failure rolls back enrichment, Task and queue atomically", async regression => {
    const { task, session } = await seed();
    const beforeTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const beforeSession = await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } });
    const beforeActivity = await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } });
    regression.mock.method(console, "error", () => undefined);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_enrichment_receipt BEFORE INSERT ON "MutationReceipt" BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
    try {
      const failed = await enrich(session.id, "rollback", { action: "enrich", ...intent });
      // SQLite ABORT is surfaced by the adapter as P2003, whose existing
      // Focus-save envelope is deliberately retained (including at receipt commit).
      assert.equal(failed.status, 409);
      assert.deepEqual(await failed.json(), { error: "The Focus session changed before it could be saved.", code: "CONFLICT" });
      assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), beforeTask);
      assert.deepEqual(await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } }), beforeSession);
      assert.deepEqual(await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } }), beforeActivity);
      assert.equal(await prisma.mutationReceipt.count(), 0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_enrichment_receipt');
    }
    assert.equal((await enrich(session.id, "rollback", { action: "enrich", ...intent })).status, 200);
    assert.equal(await prisma.mutationReceipt.count(), 1);
  });

  await context.test("fresh read failure after commit retains the receipt for the original retry", async regression => {
    const { task, session } = await seed();
    regression.mock.method(console, "error", () => undefined);
    const originalTransaction = prisma.$transaction;
    const originalAggregate = prisma.activityEntry.aggregate;
    // Inject only the trailing aggregate read failure. All writes use real disposable SQLite.
    const failAggregate = async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
      throw new Error("snapshot read unavailable");
    };
    prisma.activityEntry.aggregate = failAggregate as typeof prisma.activityEntry.aggregate;
    prisma.$transaction = ((operation: (tx: unknown) => Promise<unknown>, options: unknown) =>
      originalTransaction.call(prisma, (tx: unknown) => operation({
        ...(tx as object), activityEntry: { ...(tx as typeof prisma).activityEntry, aggregate: async () => {
          // Drain prior reads on the adapter connection before failing; avoid
          // making concurrent pending reads race the transaction rollback.
          await (tx as typeof prisma).$queryRawUnsafe("SELECT 1");
          throw new Error("snapshot read unavailable");
        } }
      }), options as never)) as typeof prisma.$transaction;
    try {
      const failed = await enrich(session.id, "read-failure", { action: "record", ...intent });
      assert.equal(failed.status, 500);
      assert.equal(await prisma.mutationReceipt.count(), 1, "write and receipt must commit before fresh reads");
    } finally {
      prisma.$transaction = originalTransaction;
      prisma.activityEntry.aggregate = originalAggregate;
    }
    await reopenAndQueue(task.id);
    const retry = await enrich(session.id, "read-failure", { action: "record", ...intent });
    assert.equal(retry.status, 200);
    const persisted = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(persisted.status, "TODO");
    assert.equal(persisted.completedAt, null);
    assert.equal(persisted.focusQueuePosition, 0);
  });

  await context.test("concurrent enrichment aliases share one write receipt", async () => {
    const { session } = await seed();
    const responses = await Promise.all(["enrich", "record"].map(action =>
      enrich(session.id, "concurrent", { action, ...intent })));
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    assert.equal(await prisma.mutationReceipt.count(), 1);
    assert.equal(await prisma.activityEntry.count(), 1);
  });

  await context.test("headerless enrichment keeps intentional repeat edits and both aliases", async () => {
    const { session } = await seed();
    assert.equal((await enrich(session.id, null, { action: "record", ...intent })).status, 200);
    const response = await enrich(session.id, null, { action: "enrich", ...intent, note: "Legacy edit" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).activity.note, "Legacy edit");
    assert.equal(await prisma.mutationReceipt.count(), 0);
  });
});

function params(id: string) { return { params: Promise.resolve({ id }) }; }
function request(path: string, method: string, body: unknown, mutationId: string | null = null) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(mutationId === null ? {} : { "X-Dayflow-Mutation-Id": mutationId }) },
    body: JSON.stringify(body)
  });
}
