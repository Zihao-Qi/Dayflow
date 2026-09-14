import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { withTransaction } from "../../src/server/prisma/client";

/**
 * The database-level proof for #122.
 *
 * Prisma opens interactive transactions on SQLite with `BEGIN IMMEDIATE`, and
 * quaint runs rusqlite on tokio workers without `spawn_blocking`. Once the
 * number of transactions in flight passes the worker count, the holder's own
 * COMMIT cannot be scheduled and the whole batch fails together at five
 * seconds with P1008. The cliff sits at N = cores + 1.
 *
 * Retries are deliberately absent: the queue has to make these succeed on the
 * first attempt or it has not fixed anything.
 */

const cores = availableParallelism();
// Past the cliff on any runner: 4-core CI cliffs at 5, this asks for 6.
const QUEUED = cores + 2;
// Far enough past it that the unqueued control cannot sit just under the edge.
const UNQUEUED = cores * 2 + 2;
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
  const database = new PrismaClient();
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

test("the queue keeps concurrent transactions past the starvation cliff alive", async (context) => {
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

test("negative control: the same batch without the queue starves with P1008", async (context) => {
  const database = scratchDatabase(context);
  await database.project.create({ data: { name: "Control fixture" } });

  // Bypassing `withTransaction` is the whole point of this control: if this
  // stops failing, the cliff has moved and the queue above proves nothing.
  const results = await Promise.allSettled(
    Array.from({ length: UNQUEUED }, () =>
      database.$transaction(async (tx) => tx.project.findMany({ take: 1 }))
    )
  );

  const codes = rejectionCodes(results);
  assert.ok(
    codes.includes("P1008"),
    `expected P1008 from ${UNQUEUED} unqueued transactions on ${cores} cores, got ${JSON.stringify(codes)}`
  );
});
