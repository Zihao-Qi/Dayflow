import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { clock } from "../../src/lib/time";

const beforeMidnight = new Date("2026-09-04T23:59:59.999-05:00");
const afterMidnight = new Date("2026-09-05T00:00:00.001-05:00");
const draft = {
  date: "2026-09-04",
  startTime: "09:00",
  endTime: "10:00",
  title: "Midnight planning",
  taskId: null
};

test("Time Block writes use the day at validation and receipts remain replayable", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-time-block-clock-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnect: (() => Promise<void>) | undefined;
  process.env.DATABASE_URL = `file:${join(directory, "dayflow.db")}`;
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
  ], { stdio: "pipe" });
  const [{ POST }, { PUT }, { prisma }] = await Promise.all([
    import("../../src/app/api/time-blocks/route"),
    import("../../src/app/api/time-blocks/[id]/route"),
    import("../../src/lib/prisma")
  ]);
  disconnect = () => prisma.$disconnect();

  for (const delay of ["body", "transaction", "receipt"] as const) {
    await context.test(`create rejects an ended day after midnight during ${delay}`, async (t) => {
      let now = beforeMidnight;
      t.mock.method(clock, "now", () => new Date(now));
      const request = jsonRequest("POST", draft, `midnight-${delay}`);
      if (delay === "body") {
        const readBody = request.json.bind(request);
        t.mock.method(request, "json", async () => {
          const body = await readBody();
          now = afterMidnight;
          return body;
        });
      } else {
        const transaction = prisma.$transaction.bind(prisma);
        replaceMethod(t, prisma, "$transaction", (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          transaction(async (tx) => {
            if (delay === "transaction") now = afterMidnight;
            else {
              const findReceipt = tx.mutationReceipt.findUnique.bind(tx.mutationReceipt);
              replaceMethod(t, tx.mutationReceipt, "findUnique", async (args: Prisma.MutationReceiptFindUniqueArgs) => {
                const receipt = await findReceipt(args);
                now = afterMidnight;
                return receipt;
              });
            }
            return run(tx);
          })
        );
      }
      const response = await POST(request);
      await assertEndedDay(response);
      assert.equal(await prisma.timeBlock.count(), 0);
      assert.equal(await prisma.mutationReceipt.count(), 0);
    });
    // Also isolate the cases when running against the defective implementation.
    await prisma.mutationReceipt.deleteMany();
    await prisma.timeBlock.deleteMany();
  }

  await context.test("a receipt replays after midnight without validating or writing again", async (t) => {
    let now = beforeMidnight;
    t.mock.method(clock, "now", () => new Date(now));
    const first = await POST(jsonRequest("POST", draft, "replay"));
    assert.equal(first.status, 201);
    const saved = await first.json();
    now = afterMidnight;
    const replay = await POST(jsonRequest("POST", draft, "replay"));
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), saved);
    assert.equal(await prisma.timeBlock.count(), 1);
    assert.equal(await prisma.mutationReceipt.count(), 1);
  });
  await prisma.mutationReceipt.deleteMany();
  await prisma.timeBlock.deleteMany();

  for (const retainDate of [false, true]) {
    await context.test(retainDate
      ? "replacement still permits correcting an unchanged past date"
      : "replacement rejects a newly past date after the stored block is read", async (t) => {
      let now = beforeMidnight;
      t.mock.method(clock, "now", () => new Date(now));
      const current = await prisma.timeBlock.create({ data: {
        ...draft,
        date: new Date(`${retainDate ? "2026-09-04" : "2026-09-06"}T00:00:00-05:00`)
      } });
      const transaction = prisma.$transaction.bind(prisma);
      replaceMethod(t, prisma, "$transaction", (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        transaction(async (tx) => {
          const findBlock = tx.timeBlock.findUnique.bind(tx.timeBlock);
          replaceMethod(t, tx.timeBlock, "findUnique", async (args: Prisma.TimeBlockFindUniqueArgs) => {
            const block = await findBlock(args);
            now = afterMidnight;
            return block;
          });
          return run(tx);
        })
      );
      const response = await PUT(jsonRequest("PUT", { ...draft, title: "Corrected" }), {
        params: Promise.resolve({ id: current.id })
      });
      if (retainDate) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).title, "Corrected");
      } else {
        await assertEndedDay(response);
      }
      const stored = await prisma.timeBlock.findUniqueOrThrow({ where: { id: current.id } });
      assert.equal(stored.date.getTime(), current.date.getTime());
      assert.equal(stored.title, retainDate ? "Corrected" : current.title);
    });
    await prisma.timeBlock.deleteMany();
  }
});

function jsonRequest(method: "POST" | "PUT", body: Record<string, unknown>, mutationId?: string) {
  return new NextRequest("http://localhost/api/time-blocks", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(mutationId ? { "X-Dayflow-Mutation-Id": mutationId } : {})
    },
    body: JSON.stringify(body)
  });
}

async function assertEndedDay(response: Response) {
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Time Blocks cannot be planned for a day that has already ended.",
    code: "VALIDATION_ERROR",
    field: "date"
  });
}

// Prisma proxy methods cannot be replaced with node:test's descriptor-based mock.method.
function replaceMethod(
  context: { after: (fn: () => void) => void },
  target: object,
  name: string,
  replacement: unknown
) {
  const methods = target as Record<string, unknown>;
  const original = methods[name];
  methods[name] = replacement;
  context.after(() => { methods[name] = original; });
}
