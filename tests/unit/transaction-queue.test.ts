import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@prisma/client";
import { withTransaction, isInsideTransaction } from "../../src/server/prisma/client";

/**
 * Barrier tests for the transaction queue, with `$transaction` replaced so they
 * run in milliseconds. The database-level proof lives in
 * tests/integration/transaction-queue.test.ts.
 */

type Callback = (transaction: unknown) => Promise<unknown>;

/** Counts how many callbacks are inside `$transaction` at once. */
function countingClient() {
  const state = { active: 0, peak: 0, entered: 0 };
  const client = {
    async $transaction(callback: Callback) {
      state.active += 1;
      state.entered += 1;
      state.peak = Math.max(state.peak, state.active);
      try {
        const result = await callback({});
        // A commit takes a turn of its own; the permit must outlive it.
        await delay(1);
        return result;
      } finally {
        state.active -= 1;
      }
    }
  } as unknown as PrismaClient;
  return { client, state };
}

test("the queue admits one transaction at a time", async () => {
  const { client, state } = countingClient();
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withTransaction(client, async () => { await delay(2); })
    )
  );
  assert.equal(state.entered, 20);
  assert.equal(state.peak, 1);
});

test("negative control: the same client overlaps without the queue", async () => {
  // Without this, `peak === 1` above could hold because the harness cannot
  // observe overlap at all, and the test would prove nothing.
  const { client, state } = countingClient();
  await Promise.all(
    Array.from({ length: 20 }, () =>
      client.$transaction(async () => { await delay(2); })
    )
  );
  assert.equal(state.entered, 20);
  assert.ok(state.peak > 1, `expected overlap without the queue, peak was ${state.peak}`);
});

test("a rejected transaction releases its permit", async () => {
  const { client, state } = countingClient();
  await assert.rejects(
    withTransaction(client, async () => { throw new Error("rolled back"); }),
    /rolled back/
  );
  // The queue keeps moving, and nothing is left holding a permit.
  assert.equal(await withTransaction(client, async () => "recovered"), "recovered");
  assert.equal(state.peak, 1);
  assert.equal(state.active, 0);
});

test("a nested transaction root is rejected rather than deadlocking", async () => {
  const { client } = countingClient();
  await assert.rejects(
    withTransaction(client, async () => withTransaction(client, async () => "inner")),
    /already open/
  );
});

test("the open-transaction marker is request-local, not a global busy flag", async () => {
  const { client } = countingClient();
  assert.equal(isInsideTransaction(), false);
  // A transaction in flight must not make an unrelated caller look nested:
  // the concurrent call waits for its turn and then succeeds.
  const held = withTransaction(client, async () => { await delay(20); return "first"; });
  const concurrent = withTransaction(client, async () => isInsideTransaction());
  assert.equal(await held, "first");
  assert.equal(await concurrent, true);
  assert.equal(isInsideTransaction(), false);
});

test("a promise left running past its transaction is not mistaken for a nested root", async () => {
  // The async context survives an unawaited promise, so the marker has to be
  // cleared when the transaction settles; otherwise this later call would be
  // refused as nested long after its transaction committed.
  const { client } = countingClient();
  let detached!: Promise<string>;
  await withTransaction(client, async () => {
    detached = delay(30).then(() => withTransaction(client, async () => "later"));
    return "outer";
  });
  assert.equal(await detached, "later");
});

test("results and errors pass through unchanged", async () => {
  const { client } = countingClient();
  assert.deepEqual(await withTransaction(client, async () => ({ ok: 1 })), { ok: 1 });
  const failure = new Error("specific");
  await assert.rejects(withTransaction(client, async () => { throw failure; }), (error) => error === failure);
});

test("transaction options reach the client untouched", async () => {
  const seen: unknown[] = [];
  const client = {
    async $transaction(callback: Callback, options: unknown) {
      seen.push(options);
      return callback({});
    }
  } as unknown as PrismaClient;
  await withTransaction(client, async () => null, { timeout: 60000 });
  // The admission deadline is the queue's own concern and must not be
  // forwarded; a caller that passes none keeps the original call shape.
  await withTransaction(client, async () => null, { admissionTimeoutMs: 5000 });
  await withTransaction(client, async () => null);
  assert.deepEqual(seen, [{ timeout: 60000 }, undefined, undefined]);
});

test("a waiter that exceeds its admission deadline never runs, and the queue recovers", async () => {
  const { client, state } = countingClient();
  let expiredRan = false;

  const holder = withTransaction(client, async () => { await delay(200); return "holder"; });
  await delay(5);
  await assert.rejects(
    withTransaction(client, async () => { expiredRan = true; }, { admissionTimeoutMs: 20 }),
    /Timed out after 20ms/
  );

  assert.equal(expiredRan, false, "an expired waiter must never execute later");
  assert.equal(await holder, "holder");
  // The permit released on expiry must not have been double-issued, and the
  // queue must still admit work afterwards.
  assert.equal(await withTransaction(client, async () => "after"), "after");
  assert.equal(state.peak, 1);
  assert.equal(state.active, 0);
});
