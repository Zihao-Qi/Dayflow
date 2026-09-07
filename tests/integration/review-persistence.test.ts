import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { reviewPeriodRange, startOfLocalDay } from "../../src/lib/dates";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

test("Review saves upsert one period row without changing Diary evidence", async (context) => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-review-persistence-test-")
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

  const [{ PUT }, { GET: loadBootstrap }, { prisma }] = await Promise.all([
    import("../../src/app/api/review/route"),
    import("../../src/app/api/bootstrap/route"),
    import("../../src/lib/prisma")
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  const period = reviewPeriodRange(new Date());
  const diaryDate = startOfLocalDay(new Date());
  const diary = await prisma.diaryEntry.create({
    data: {
      date: diaryDate,
      content: "Persisted Diary content",
      reflection: "Independent reflection",
      mood: 4,
      energy: 2
    }
  });
  const payload = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    narrative: "  Chose the important work.  ",
    nextPeriodIntention: "  Protect deep work.  "
  };

  const first = await PUT(reviewRequest(payload));
  assert.equal(first.status, 200);
  const firstReview = (await first.json()) as {
    id: string;
    periodStart: string;
    periodEnd: string;
    narrative: string;
    nextPeriodIntention: string;
    persisted: boolean;
  };
  assert.equal(firstReview.periodStart, payload.periodStart);
  assert.equal(firstReview.periodEnd, payload.periodEnd);
  assert.equal(firstReview.narrative, "Chose the important work.");
  assert.equal(firstReview.nextPeriodIntention, "Protect deep work.");
  assert.equal(firstReview.persisted, true);

  const second = await PUT(
    reviewRequest({
      ...payload,
      narrative: "Updated account of what moved.",
      nextPeriodIntention: ""
    })
  );
  assert.equal(second.status, 200);
  const secondReview = (await second.json()) as typeof firstReview;
  assert.equal(secondReview.id, firstReview.id);
  assert.equal(secondReview.narrative, "Updated account of what moved.");
  assert.equal(secondReview.nextPeriodIntention, "");
  assert.equal(secondReview.persisted, true);

  assert.equal(await prisma.review.count(), 1);
  const reload = await loadBootstrap();
  assert.equal(reload.status, 200);
  const reloaded = (await reload.json()) as {
    review: typeof firstReview;
  };
  assert.equal(reloaded.review.id, firstReview.id);
  assert.equal(reloaded.review.periodStart, payload.periodStart);
  assert.equal(reloaded.review.periodEnd, payload.periodEnd);
  assert.equal(reloaded.review.narrative, "Updated account of what moved.");
  assert.equal(reloaded.review.nextPeriodIntention, "");
  assert.equal(reloaded.review.persisted, true);

  assert.deepEqual(
    await prisma.diaryEntry.findUnique({
      where: { id: diary.id },
      select: {
        content: true,
        reflection: true,
        mood: true,
        energy: true
      }
    }),
    {
      content: "Persisted Diary content",
      reflection: "Independent reflection",
      mood: 4,
      energy: 2
    }
  );
  assert.equal(await prisma.diaryEntry.count(), 1);
});

function reviewRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/review", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
