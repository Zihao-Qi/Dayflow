import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { withTransaction } from "../../src/server/prisma/client";
import { createSqliteAdapter } from "../../src/server/prisma/sqlite";
import { setImmediate } from "node:timers/promises";

/**
 * The old Prisma 6 engine starved at cores+1 (issue #122). Prisma 7's adapter
 * queues one connection itself, so that engine-specific failure is no longer
 * an honest negative control. The process queue still governs admission across
 * separate clients and keeps the existing budgets/nesting contract. Exercise
 * that boundary independently of the adapter's own connection mutex.
 */

const cores = availableParallelism();
// Past the cliff on any runner: 4-core CI cliffs at 5, this asks for 6.
const QUEUED = cores + 2;
const BUDGET_MS = 30_000;

function scratchDatabase(context: { after: (fn: () => unknown) => void }) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-transaction-queue-"));
  const databasePath = join(directory, "dayflow.db");
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${databasePath}`;
  execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
    input: readFileSync(join(process.cwd(), "prisma/init.sql")),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const database = new PrismaClient({ adapter: createSqliteAdapter(process.env.DATABASE_URL) });
  context.after(async () => {
    try {
      await database.$disconnect();
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return database;
}

function rejectionCodes(results: PromiseSettledResult<unknown>[]) {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason as { code?: string })?.code ?? String(result.reason));
}

test("the queue completes concurrent transactions beyond the old engine's starvation threshold", async (context) => {
  const database = scratchDatabase(context);
  await database.project.create({ data: { name: "Queue fixture" } });

  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: QUEUED }, () =>
      withTransaction(database, async (tx) => tx.project.findMany({ take: 1 }))
    )
  );
  const elapsed = Date.now() - started;

  assert.deepEqual(
    rejectionCodes(results),
    [],
    `${QUEUED} queued transactions on ${cores} cores must all succeed`
  );
  // The five-second wall is the signature of the starvation; serialised reads
  // finish in milliseconds.
  assert.ok(elapsed < BUDGET_MS, `queued batch took ${elapsed}ms`);
});

test("the process queue holds a second client before dispatching its transaction", async (context) => {
  const database = scratchDatabase(context);
  await database.project.create({ data: { name: "Admission fixture" } });
  const second = new PrismaClient({ adapter: createSqliteAdapter(process.env.DATABASE_URL!) });
  context.after(() => second.$disconnect());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first = withTransaction(database, async (tx) => {
    await tx.project.findMany();
    entered.resolve();
    await release.promise;
  });
  void first.catch(entered.reject);
  let next: Promise<unknown> | undefined;
  try {
    await entered.promise;
    let dispatched = false;
    const original = second.$transaction.bind(second);
    Object.assign(second, { $transaction: (...args: Parameters<typeof original>) => {
      dispatched = true;
      return original(...args);
    } });
    next = withTransaction(second, (tx) => tx.project.findMany());
    void next.catch(() => undefined);
    // Root dispatch is synchronous once admission succeeds. Yield past promise
    // continuations while the first real transaction is deliberately held.
    await setImmediate();
    assert.equal(dispatched, false, "a competing client must not reach Prisma before the first root settles");
    release.resolve();
    await Promise.all([first, next]);
    assert.equal(dispatched, true, "the admitted operation must run after release");
  } finally {
    release.resolve();
    await Promise.allSettled([first, ...(next ? [next] : [])]);
  }
});
