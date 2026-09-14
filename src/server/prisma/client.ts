import { getPrisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The single transaction root. Every interactive transaction in the tree opens
 * through here, and Rule 6 confines `$transaction` to this file.
 *
 * Prisma opens interactive transactions on SQLite with `BEGIN IMMEDIATE`, even
 * when the callback only reads, so concurrent transactions never overlap: one
 * holds the write lock and the rest wait. The waiting is the problem. Quaint
 * runs rusqlite on tokio's worker threads without `spawn_blocking`, so every
 * blocked transaction occupies a worker; once the number in flight reaches the
 * worker count the holder's own COMMIT cannot be scheduled, and the pile times
 * out together at five seconds as P1008. Measured on this tree: clean through
 * N = cores, then at N = cores + 1 a 5.2s wall with rejections (8 cores: N=9
 * rejected four, N=12 rejected eight). Upstream reports the same cliff in
 * prisma/prisma#29870.
 *
 * The queue therefore removes no parallelism — SQLite had already serialised
 * these transactions. It moves the waiting off the engine's workers and into
 * this process, where waiting is free. A direct experiment against a scratch
 * database confirmed the premise: with one transaction held open for 800ms, a
 * second transaction's callback did not enter until the first committed, for
 * read/read, write/read and write/write alike, while the same two operations
 * outside a transaction overlapped at 22ms.
 *
 * This supersedes the per-route queue that guarded focus-session starts.
 */

const globalForTransactions = globalThis as typeof globalThis & {
  dayflowTransactionQueue?: Promise<void>;
};

// Request-local, so nesting is detected by where the call actually happens
// rather than by whether the queue is busy. A global "locked means nested"
// flag would misread an unrelated concurrent transaction as a nested one.
//
// The marker is cleared when the transaction settles. A promise spawned
// inside the callback and left unawaited keeps this store, so without the
// flag it would be refused as nested long after its transaction committed.
const openTransaction = new AsyncLocalStorage<{ open: boolean }>();

/**
 * How long a caller may wait for its turn. This bounds admission only; a
 * transaction's own budget is separate. An expired waiter never runs the
 * operation, so a caller that has given up cannot execute later.
 *
 * It must exceed the longest transaction in the tree, or the queue would
 * reject healthy callers while the transaction ahead of them is still running
 * well inside its own budget. Four roots carry a 60s budget today: bootstrap,
 * agent export, and the three Review reads. A caller whose own budget is
 * longer raises its admission deadline to match.
 */
const ADMISSION_TIMEOUT_MS = 120_000;

type TransactionOptions = {
  timeout?: number;
  maxWait?: number;
  /** Overrides `ADMISSION_TIMEOUT_MS`; the tests use it to exercise expiry. */
  admissionTimeoutMs?: number;
};

export function isInsideTransaction() {
  return openTransaction.getStore()?.open === true;
}

export async function withTransaction<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  if (isInsideTransaction()) {
    // Opening a second root inside a transaction would wait on a permit this
    // call already holds, and deadlock. Callers that already own a transaction
    // pass their `Prisma.TransactionClient` to the service directly.
    throw new Error(
      "A transaction is already open on this call path; pass the existing transaction client instead of opening another root."
    );
  }
  const { admissionTimeoutMs, ...passThrough } = options ?? {};
  // Preserve the previous call shape exactly when no options were given.
  const prismaOptions = Object.keys(passThrough).length > 0 ? passThrough : undefined;
  const deadline =
    admissionTimeoutMs ?? Math.max(ADMISSION_TIMEOUT_MS, passThrough.timeout ?? 0);

  const release = await acquire(deadline);
  try {
    // Read `$transaction` at call time. Test harnesses replace the method on
    // the client after construction, so a wrapper bound at construction would
    // be discarded exactly where transactions are exercised.
    return await database.$transaction((transaction) => {
      const marker = { open: true };
      return openTransaction.run(marker, async () => {
        try {
          return await operation(transaction);
        } finally {
          marker.open = false;
        }
      });
    }, prismaOptions);
  } finally {
    release();
  }
}

/**
 * Take the next permit. The tail is held on `globalThis` so a development
 * reload does not hand out a second permit against the same database file.
 */
function acquire(admissionTimeoutMs: number): Promise<() => void> {
  let release!: () => void;
  const permit = new Promise<void>((resolve) => { release = resolve; });
  const ahead = globalForTransactions.dayflowTransactionQueue ?? Promise.resolve();
  globalForTransactions.dayflowTransactionQueue = ahead.then(
    () => permit,
    () => permit
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Release so the queue keeps moving, then reject without ever running
      // the operation.
      release();
      reject(new Error(`Timed out after ${admissionTimeoutMs}ms waiting to open a transaction.`));
    }, admissionTimeoutMs);
    timer.unref?.();

    ahead.then(
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(release); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(release); } }
    );
  });
}

/** Convenience root for callers that do not inject a client. */
export function runInTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions
) {
  return withTransaction(getPrisma(), operation, options);
}
