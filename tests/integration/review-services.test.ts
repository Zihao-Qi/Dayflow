import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { calendarFor } from "../../src/shared/kernel/calendar";
import { AppError } from "../../src/shared/kernel/errors";
import { serializeAppError } from "../../src/lib/http-errors";
import { isReviewWindowDetail, parseReviewMutation } from "../../src/modules/review/domain/review";
import {
  saveReview, readSavedReview, readReviewPeriodEvidence, readPastReviewPeriod,
  readReviewWindow, readReviewHistoryPage
} from "../../src/modules/review/services/reviews";
import { readReviewWindow as readLegacyReviewWindow } from "../../src/lib/review-history";
import { listProjectSummaries } from "../../src/server/read-models/project-summaries";

const now = new Date("2026-09-04T12:00:00-05:00");
const calendar = calendarFor("America/Chicago");
const current = { start: new Date("2026-08-29T05:00:00.000Z"), end: new Date("2026-09-05T05:00:00.000Z") };
const past = { start: new Date("2026-08-18T05:00:00.000Z"), end: new Date("2026-08-25T05:00:00.000Z") };
const input = (narrative = "  Deliberate progress.  ") => parseReviewMutation({
  periodStart: current.start.toISOString(), periodEnd: current.end.toISOString(),
  narrative, nextPeriodIntention: "  Protect mornings.  "
}, calendar);

async function withDatabase(context: { after: (fn: () => unknown) => void }, run: (db: PrismaClient, url: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-review-services-"));
  const url = `file:${join(directory, "dayflow.db")}`;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"),
    "db", "execute", "--file", "prisma/init.sql", "--url", url], { stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } } });
  context.after(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
  await run(db, url);
}

const emptySummary = {
  recordedMinutes: 0, focusedMinutes: 0, categoryMinutes: [], completedTaskCount: 0,
  noteCount: 0, materialCount: 0, diaryDayCount: 0, averageMood: null, averageEnergy: null,
  pendingEnrichmentSessions: 0, pendingEnrichmentMinutes: 0, movedProjectCount: 0
};

test("Review services run headlessly on SQLite", async context => {
  await withDatabase(context, async (db, url) => {
    await context.test("current mode returns the exact normalized unpersisted editor without writing", async () => {
      const detail = await db.$transaction(tx => readReviewWindow(tx, new URLSearchParams("current=1"), now, calendar));
      assert.equal(JSON.stringify(detail), JSON.stringify({
        ending: "2026-09-04", periodStart: current.start, periodEnd: current.end,
        review: { id: null, periodStart: current.start, periodEnd: current.end,
          narrative: "", nextPeriodIntention: "", persisted: false },
        reviewSummary: emptySummary, projects: []
      }));
      assert.equal(isReviewWindowDetail(JSON.parse(JSON.stringify(detail))), true);
      assert.equal(await db.review.count(), 0);
    });

    await context.test("save upserts only the current period and composes with caller rollback", async () => {
      const first = await db.$transaction(tx => saveReview(tx, input(), now, calendar));
      assert.equal(first.narrative, "Deliberate progress.");
      assert.equal(first.nextPeriodIntention, "Protect mornings.");
      assert.equal(first.persisted, true);
      const second = await db.$transaction(tx => saveReview(tx, input("Updated"), now, calendar));
      assert.equal(second.id, first.id);
      const { persisted: _persisted, ...savedRow } = second;
      assert.deepEqual(await db.$transaction(tx => readSavedReview(tx, current)), savedRow);
      await assert.rejects(() => db.$transaction(async tx => {
        await saveReview(tx, input("Must roll back"), now, calendar);
        throw new Error("rollback");
      }), /rollback/);
      assert.equal((await db.$transaction(tx => readSavedReview(tx, current)))?.narrative, "Updated");
      const detail = await db.$transaction(tx => readReviewWindow(tx, new URLSearchParams("current=1"), now, calendar));
      assert.deepEqual(detail.review, second);
      assert.equal(await db.review.count(), 1);
    });

    await context.test("the legacy window shim composes on an existing transaction", async () => {
      await db.$transaction(async tx => {
        const detail = await readLegacyReviewWindow(tx, new URLSearchParams("current=1"), now);
        assert.equal(detail.review?.narrative, "Updated");
      });
    });

    await context.test("a non-current period is rejected with the exact 409 envelope", async () => {
      const before = await db.review.findMany();
      await assert.rejects(() => db.$transaction(tx => saveReview(tx, {
        ...input(), periodStart: past.start, periodEnd: past.end
      }, now, calendar)), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.deepEqual(serializeAppError(error), { status: 409, body: {
          error: "The Review Period changed. Refresh and try again.", code: "REVIEW_PERIOD_CHANGED", field: "reviewPeriod"
        } });
        return true;
      });
      assert.deepEqual(await db.review.findMany(), before);
    });

    const project = await db.project.create({ data: { name: "Evidence project" } });
    const task = await db.task.create({ data: { title: "Done", status: "DONE", projectId: project.id, completedAt: current.start } });
    await db.activityEntry.create({ data: { startedAt: current.start, durationMinutes: 42, category: "Learning", note: "Unchanged", attributedProjectId: project.id } });
    await db.activityEntry.create({ data: { startedAt: current.end, durationMinutes: 999, category: "Excluded", note: "Exclusive end" } });
    await db.diaryEntry.create({ data: { date: current.start, content: "Independent", reflection: "Kept", mood: 4, energy: 2 } });
    await db.note.create({ data: { date: current.start, content: "Decision", taskId: task.id } });
    await db.material.create({ data: { title: "Reference", url: "https://example.com", createdAt: current.start, projectId: project.id } });
    const evidenceSnapshot = async () => JSON.stringify(await Promise.all([
      db.activityEntry.findMany(), db.diaryEntry.findMany(), db.task.findMany(), db.note.findMany(), db.material.findMany(), db.project.findMany()
    ]));

    await context.test("summary derives evidence and period project metrics without mutating any evidence", async () => {
      const before = await evidenceSnapshot();
      const result = await db.$transaction(async tx => {
        await saveReview(tx, input("Interpretation only"), now, calendar);
        const evidence = await readReviewPeriodEvidence(tx, current);
        assert.deepEqual(evidence.projects, await listProjectSummaries(tx, current));
        return evidence;
      });
      assert.deepEqual(result.summary, { ...emptySummary, recordedMinutes: 42,
        categoryMinutes: [{ category: "Learning", minutes: 42 }], completedTaskCount: 1,
        noteCount: 1, materialCount: 1, diaryDayCount: 1, averageMood: 4, averageEnergy: 2, movedProjectCount: 1 });
      assert.equal(result.projects[0].reviewPeriodInvestedMinutes, 42);
      assert.equal(await evidenceSnapshot(), before);
    });

    await context.test("past windows use stored bounds, matching only an exact saved review", async () => {
      await db.activityEntry.create({ data: { startedAt: past.start, durationMinutes: 17, category: "Admin", note: "Past evidence" } });
      await db.activityEntry.create({ data: { startedAt: past.end, durationMinutes: 800, category: "Excluded", note: "Past exclusive end" } });
      const overlap = await db.review.create({ data: { periodStart: new Date("2026-08-17T05:00:00.000Z"), periodEnd: new Date("2026-08-24T05:00:00.000Z"), narrative: "Overlap" } });
      const query = new URLSearchParams("ending=2026-08-24");
      const before = await evidenceSnapshot();
      const unsaved = await db.$transaction(tx => readReviewWindow(tx, query, now, calendar));
      assert.equal(unsaved.review, null);
      assert.equal(unsaved.reviewSummary.recordedMinutes, 17);
      const saved = await db.review.create({ data: { periodStart: past.start, periodEnd: past.end, narrative: "Own boundaries" } });
      const detail = await db.$transaction(tx => readPastReviewPeriod(tx, saved.id, now, calendar));
      assert.deepEqual(detail.review, { ...saved, persisted: true });
      assert.equal(detail.isCurrentPeriod, false);
      assert.equal(detail.reviewSummary.recordedMinutes, 17);
      const window = await db.$transaction(tx => readReviewWindow(tx, query, now, calendar));
      assert.deepEqual(window.review, detail.review);
      assert.deepEqual(window.reviewSummary, detail.reviewSummary);
      assert.equal(await evidenceSnapshot(), before);
      await db.review.deleteMany({ where: { id: { in: [saved.id, overlap.id] } } });
    });

    await context.test("history paginates tied starts once, excludes current, and keeps snapshot totals during an insert", async () => {
      for (const [id, end] of [["tie-a", "2026-08-25"], ["tie-b", "2026-08-26"], ["tie-c", "2026-08-27"]]) {
        // Restored rows may share starts with different ends; the cursor must retain the id tie-breaker.
        await db.review.create({ data: { id, periodStart: past.start, periodEnd: new Date(`${end}T05:00:00.000Z`), narrative: id } });
      }
      const writer = new PrismaClient({ datasources: { db: { url } } });
      let inserted: Promise<unknown> | undefined;
      try {
        const page = await db.$transaction(async tx => {
          const instrumented = { ...tx, review: { ...tx.review, findMany: async (args: Prisma.ReviewFindManyArgs) => {
            const rows = await tx.review.findMany(args);
            inserted = writer.review.create({ data: { id: "newer", periodStart: new Date("2026-08-20T05:00:00.000Z"), periodEnd: new Date("2026-08-28T05:00:00.000Z"), narrative: "Concurrent" } }).then(row => row);
            void inserted.catch(() => undefined);
            return rows;
          } } } as Prisma.TransactionClient;
          return readReviewHistoryPage(instrumented, new URLSearchParams("limit=1"), now, calendar);
        });
        assert.ok(inserted);
        await inserted;
        assert.equal(page.totalCount, 3);
        assert.deepEqual(page.items.map(row => row.id), ["tie-c"]);
        assert.ok(page.nextCursor);
        const next = await db.$transaction(tx => readReviewHistoryPage(tx, new URLSearchParams({ limit: "1", cursor: page.nextCursor! }), now, calendar));
        assert.equal(next.totalCount, 4);
        assert.deepEqual(next.items.map(row => row.id), ["tie-b"]);
        const last = await db.$transaction(tx => readReviewHistoryPage(tx, new URLSearchParams({ limit: "1", cursor: next.nextCursor! }), now, calendar));
        assert.deepEqual(last.items.map(row => row.id), ["tie-a"]);
        assert.equal(last.nextCursor, null);
        const fresh = await db.$transaction(tx => readReviewHistoryPage(tx, new URLSearchParams("limit=100"), now, calendar));
        assert.deepEqual(fresh.items.map(row => row.id), ["newer", "tie-c", "tie-b", "tie-a"]);
        assert.equal(fresh.totalCount, 4);
      } finally { await writer.$disconnect(); }
    });
  });
});
