import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { addDays, reviewPeriodRange, startOfLocalDay } from "../../src/lib/dates";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    history: typeof import("../../src/lib/review-history");
    loadBootstrap: typeof import("../../src/app/api/bootstrap/route").GET;
  }) => Promise<void>
) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-review-history-test-")
  );
  const databasePath = join(temporaryDirectory, "dayflow.db");
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnectPrisma: (() => Promise<void>) | null = null;
  process.env.DATABASE_URL = `file:${databasePath.split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnectPrisma?.();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  execFileSync(
    process.execPath,
    [
      prismaCliPath,
      "db",
      "execute",
      "--file",
      "prisma/init.sql",
      "--url",
      process.env.DATABASE_URL
    ],
    { cwd: repositoryRoot, stdio: "pipe" }
  );

  const [history, bootstrap, { prisma }] = await Promise.all([
    import("../../src/lib/review-history"),
    import("../../src/app/api/bootstrap/route"),
    import("../../src/lib/prisma")
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  await run({ prisma, history, loadBootstrap: bootstrap.GET });
}

/** The window a Review saved `daysAgo` days ago would own. */
function windowSavedDaysAgo(daysAgo: number) {
  const today = startOfLocalDay();
  const periodEnd = addDays(today, 1 - daysAgo);
  return { periodStart: addDays(periodEnd, -7), periodEnd };
}

test("every saved Review is reachable regardless of how long ago it was saved", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    // An offset grid anchored on today can only land on saved Reviews whose
    // save date is an exact multiple of seven days behind today. These save
    // dates deliberately mix multiples and non-multiples of seven.
    const saveDates = [1, 2, 3, 5, 7, 9, 14, 21];
    for (const daysAgo of saveDates) {
      await prisma.review.create({
        data: {
          ...windowSavedDaysAgo(daysAgo),
          narrative: `saved ${daysAgo} days ago`,
          nextPeriodIntention: ""
        }
      });
    }

    const page = await history.readReviewHistoryPage(
      prisma,
      new URLSearchParams("limit=100")
    );
    assert.equal(page.totalCount, saveDates.length);
    assert.deepEqual(
      page.items.map((review) => review.narrative).sort(),
      saveDates.map((daysAgo) => `saved ${daysAgo} days ago`).sort()
    );

    // Each one also opens on its own stored boundaries.
    for (const review of page.items) {
      const detail = await history.readPastReviewPeriod(prisma, review.id);
      assert.equal(detail.review.id, review.id);
      assert.equal(detail.isCurrentPeriod, false);
      assert.equal(
        detail.review.periodStart.getTime(),
        review.periodStart.getTime()
      );
    }
  });
});

test("Review history excludes the current period and orders newest first", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    const current = reviewPeriodRange();
    await prisma.review.create({
      data: {
        periodStart: current.start,
        periodEnd: current.end,
        narrative: "current period",
        nextPeriodIntention: ""
      }
    });
    for (const daysAgo of [7, 14, 21]) {
      await prisma.review.create({
        data: {
          ...windowSavedDaysAgo(daysAgo),
          narrative: `older ${daysAgo}`,
          nextPeriodIntention: ""
        }
      });
    }

    const page = await history.readReviewHistoryPage(
      prisma,
      new URLSearchParams("limit=100")
    );
    assert.equal(page.totalCount, 3);
    assert.equal(
      page.items.some((review) => review.narrative === "current period"),
      false
    );
    assert.deepEqual(
      page.items.map((review) => review.narrative),
      ["older 7", "older 14", "older 21"]
    );
  });
});

test("Review history pagination reaches every saved Review exactly once", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    const saveDates = [3, 6, 9, 12, 15, 18, 21];
    for (const daysAgo of saveDates) {
      await prisma.review.create({
        data: {
          ...windowSavedDaysAgo(daysAgo),
          narrative: `page ${daysAgo}`,
          nextPeriodIntention: ""
        }
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let request = 0; request < 20; request += 1) {
      const query = new URLSearchParams("limit=2");
      if (cursor) query.set("cursor", cursor);
      const page = await history.readReviewHistoryPage(prisma, query);
      assert.equal(page.totalCount, saveDates.length);
      seen.push(...page.items.map((review) => review.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    assert.equal(cursor, null, "pagination did not terminate");
    assert.equal(seen.length, saveDates.length);
    assert.equal(new Set(seen).size, saveDates.length, "a Review repeated");
  });
});

test("a past window derives the same summary the current period would", async (context) => {
  await withDatabase(context, async ({ prisma, history, loadBootstrap }) => {
    const today = startOfLocalDay();
    const current = reviewPeriodRange();

    // Identical evidence placed in the current window and in an older one.
    const shape = [
      { offsetDays: 1, minutes: 50, category: "Deep Work" },
      { offsetDays: 2, minutes: 25, category: "Admin" }
    ];
    for (const entry of shape) {
      await prisma.activityEntry.create({
        data: {
          startedAt: addDays(today, -entry.offsetDays),
          durationMinutes: entry.minutes,
          category: entry.category,
          note: "recorded"
        }
      });
      await prisma.activityEntry.create({
        data: {
          startedAt: addDays(today, -entry.offsetDays - 14),
          durationMinutes: entry.minutes,
          category: entry.category,
          note: "recorded"
        }
      });
    }

    // Bootstrap and the shared read agree about the current period.
    const bootstrapPayload = await (await loadBootstrap()).json();
    const currentSummary = (
      await history.readReviewPeriodEvidence(prisma, current)
    ).summary;
    assert.deepEqual(
      JSON.parse(JSON.stringify(bootstrapPayload.reviewSummary)),
      JSON.parse(JSON.stringify(currentSummary))
    );

    // The older window carries identical evidence, so it derives identical
    // totals: the derivation follows the interval, not today.
    const olderSummary = (
      await history.readReviewPeriodEvidence(prisma, {
        start: addDays(current.start, -14),
        end: addDays(current.end, -14)
      })
    ).summary;
    assert.equal(olderSummary.recordedMinutes, currentSummary.recordedMinutes);
    assert.deepEqual(olderSummary.categoryMinutes, currentSummary.categoryMinutes);
    assert.equal(olderSummary.recordedMinutes, 75);
  });
});

test("reading a Past Review Period changes no stored record", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    const today = startOfLocalDay();
    const saved = await prisma.review.create({
      data: {
        ...windowSavedDaysAgo(9),
        narrative: "what moved forward",
        nextPeriodIntention: "protect deep work"
      }
    });
    await prisma.activityEntry.create({
      data: {
        startedAt: addDays(today, -10),
        durationMinutes: 40,
        category: "Learning",
        note: "inside the saved window"
      }
    });
    await prisma.diaryEntry.create({
      data: { date: addDays(today, -10), content: "a day", mood: 4, energy: 4 }
    });

    const snapshot = async () =>
      JSON.stringify({
        reviews: await prisma.review.findMany({ orderBy: { id: "asc" } }),
        activities: await prisma.activityEntry.findMany({ orderBy: { id: "asc" } }),
        diaries: await prisma.diaryEntry.findMany({ orderBy: { id: "asc" } }),
        receipts: await prisma.mutationReceipt.count()
      });

    const before = await snapshot();
    const detail = await history.readPastReviewPeriod(prisma, saved.id);
    assert.equal(detail.review.narrative, "what moved forward");
    assert.equal(detail.reviewSummary.recordedMinutes, 40);
    assert.equal(detail.reviewSummary.averageMood, 4);
    await history.readReviewHistoryPage(prisma, new URLSearchParams());
    assert.equal(await snapshot(), before, "a read mutated stored evidence");
  });
});

test("an unknown or malformed Review identifier is rejected before querying", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    await assert.rejects(
      () => history.readPastReviewPeriod(prisma, "../secrets"),
      (error: unknown) =>
        error instanceof history.ReviewHistoryRequestError &&
        error.code === "VALIDATION_ERROR" &&
        error.status === 400
    );
    await assert.rejects(
      () => history.readPastReviewPeriod(prisma, "ckmissing00000000000"),
      (error: unknown) =>
        error instanceof history.ReviewHistoryRequestError &&
        error.code === "REVIEW_NOT_FOUND" &&
        error.status === 404
    );
  });
});

test("correcting Evidence in an earlier window changes its summary, not its narrative", async (context) => {
  await withDatabase(context, async ({ prisma, history }) => {
    const today = startOfLocalDay();
    const saved = await prisma.review.create({
      data: {
        ...windowSavedDaysAgo(9),
        narrative: "as it was written then",
        nextPeriodIntention: "left alone"
      }
    });
    const activity = await prisma.activityEntry.create({
      data: {
        startedAt: addDays(today, -10),
        durationMinutes: 30,
        category: "Deep Work",
        note: "inside the saved window"
      }
    });

    const before = await history.readPastReviewPeriod(prisma, saved.id);
    assert.equal(before.reviewSummary.recordedMinutes, 30);

    // Nothing is snapshotted, so a later correction is reflected.
    await prisma.activityEntry.update({
      where: { id: activity.id },
      data: { durationMinutes: 55 }
    });

    const after = await history.readPastReviewPeriod(prisma, saved.id);
    assert.equal(after.reviewSummary.recordedMinutes, 55);
    assert.equal(after.review.narrative, "as it was written then");
    assert.equal(after.review.nextPeriodIntention, "left alone");
    assert.equal(
      after.review.updatedAt.getTime(),
      before.review.updatedAt.getTime(),
      "the saved Review must not be rewritten by a read"
    );
  });
});
