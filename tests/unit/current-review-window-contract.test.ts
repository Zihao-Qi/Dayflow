import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { localDateKey, reviewPeriodRange } from "../../src/lib/dates";
import { isCurrentReviewWindow } from "../../src/shared/client/decoders";

// Install an explicit read-only database fixture before importing the route.
// Prisma delegates are proxies, so node:test method mocks need plain delegates.
const prisma = Object.fromEntries(
  ["activityEntry", "diaryEntry", "task", "note", "material", "project", "review"].map((name) => [name, {
    findMany: async () => [], findUnique: async () => null,
    upsert: async () => { throw new Error("Read must not persist"); }
  }])
) as unknown as PrismaClient;
// The window read now opens a transaction before touching any delegate; the
// fixture runs it against the same delegates so the mocks below still apply.
(prisma as unknown as { $transaction: unknown }).$transaction = async (
  operation: (tx: PrismaClient) => unknown
) => operation(prisma);
(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
const route = import("../../src/app/api/review/window/route");
async function GET(request: NextRequest) { return (await route).GET(request); }

const request = (query: string) => new NextRequest(`http://localhost/api/review/window?${query}`);

for (const persisted of [false, true]) {
  test(`current Review window selects server bounds and returns ${persisted ? "saved" : "unpersisted"} writing without a write`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T12:00:00-05:00") });
    const period = reviewPeriodRange(new Date());
    for (const delegate of [prisma.activityEntry, prisma.diaryEntry, prisma.task, prisma.note, prisma.material, prisma.project]) {
      t.mock.method(delegate, "findMany", async () => []);
    }
    // Project investment is now grouped from an attributedProjectId column rather
    // than a per-project `attributedActivities` include, so the row must carry it.
    const activity = { id: "evidence", attributedProjectId: "project", startedAt: period.start, durationMinutes: 17, category: "Research", origin: "MANUAL" };
    const evidenceRead = t.mock.method(prisma.activityEntry, "findMany", async () => [activity]);
    t.mock.method(prisma.project, "findMany", async () => [{
      id: "project", name: "Current evidence", tasks: [], phases: [], attributedActivities: [activity]
    }]);
    const saved = {
      id: "saved-review", periodStart: period.start, periodEnd: period.end,
      narrative: "Actual saved writing", nextPeriodIntention: "Keep it"
    };
    const read = t.mock.method(prisma.review, "findUnique", async () => persisted ? saved : null);
    const write = t.mock.method(prisma.review, "upsert", async () => { throw new Error("Read must not persist"); });
    const response = await GET(request("current=1"));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ["ending", "periodEnd", "periodStart", "projects", "review", "reviewSummary"]);
    assert.equal(payload.ending, "2026-09-04");
    assert.equal(payload.periodStart, period.start.toISOString());
    assert.equal(payload.periodEnd, period.end.toISOString());
    assert.deepEqual(payload.review, {
      id: persisted ? saved.id : null,
      periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(),
      narrative: persisted ? saved.narrative : "", nextPeriodIntention: persisted ? saved.nextPeriodIntention : "", persisted
    });
    assert.equal(payload.projects[0].id, "project");
    assert.equal(payload.projects[0].reviewPeriodInvestedMinutes, 17);
    assert.equal(payload.reviewSummary.movedProjectCount, 1);
    assert.equal(payload.reviewSummary.recordedMinutes, 17);
    assert.deepEqual(evidenceRead.mock.calls[0].arguments[0], {
      where: { startedAt: { gte: period.start, lt: period.end } },
      orderBy: { startedAt: "asc" }, include: { focusSession: { select: { needsEnrichment: true } } }
    });
    assert.equal(payload.reviewSummary.diaryDayCount, 0);
    assert.equal(isCurrentReviewWindow(payload), true);
    assert.equal(read.mock.callCount(), 1);
    assert.deepEqual(read.mock.calls[0].arguments[0], {
      where: { periodStart_periodEnd: { periodStart: period.start, periodEnd: period.end } }
    });
    assert.equal(write.mock.callCount(), 0);
    assert.equal(isCurrentReviewWindow({ ...payload, review: null }), false);
    assert.equal(isCurrentReviewWindow({ ...payload, review: { ...payload.review, periodEnd: period.start.toISOString() } }), false);
  });
}

test("current Review mode rejects ambiguous selection with the existing error envelope", async () => {
  for (const query of ["current=0", "current=", "current=1&current=1", "current=1&ending=2026-08-01"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Use current=1 without a Review Window ending day.", code: "VALIDATION_ERROR" });
  }
});

test("historical ending mode still rejects today and still requires an ending", async () => {
  for (const [query, error] of [
    [`ending=${localDateKey(new Date())}`, "Review Windows must end before today."],
    ["", "Choose a Review Window ending day."]
  ]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error, code: "VALIDATION_ERROR" });
  }
});

test("current Review read failures retain the window INTERNAL_ERROR envelope", async (t) => {
  for (const delegate of [prisma.activityEntry, prisma.diaryEntry, prisma.task, prisma.note, prisma.material, prisma.project]) {
    t.mock.method(delegate, "findMany", async () => []);
  }
  t.mock.method(prisma.review, "findUnique", async () => { throw new Error("Read offline"); });
  t.mock.method(console, "error", () => {});
  const response = await GET(request("current=1"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Review Window could not be read.", code: "INTERNAL_ERROR" });
});
