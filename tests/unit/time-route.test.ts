import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../src/app/api/agent-export/route";
import { getPrisma } from "../../src/lib/prisma";
const prisma = getPrisma();
import { clock } from "../../src/lib/time";
import { frozenClock } from "../../src/shared/kernel/calendar";

test("agent export captures its clock once before reading the database", async (t) => {
  const at = frozenClock(new Date("2026-09-04T04:59:59.999Z"));
  const readClock = t.mock.method(clock, "now", () => at.now());
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
  });
  (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
    assert.equal(readClock.mock.callCount(), 1);
    return Array.from({ length: 11 }, () => []);
  };
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.exportedAt, "2026-09-04T04:59:59.999Z");
  assert.equal(readClock.mock.callCount(), 1);
});
