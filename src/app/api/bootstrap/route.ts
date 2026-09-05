import { buildActivityCategorySuggestions } from "@/lib/activity-categories";
import { bootstrapErrors } from "@/lib/bootstrap-errors";
import {
  addDays,
  localDateKey,
  reviewPeriodRange,
  sameDayRange,
  startOfLocalDay
} from "@/lib/dates";
import {
  DAY_VIEW_FORWARD_WEEKS,
  earliestRecordedDay,
  resolveEarliestNavigableDayKey
} from "@/lib/day-view";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { readReviewPeriodEvidence } from "@/lib/review-history";
import { serializeTimeBlock } from "@/lib/time-block-persistence";
import { isTimeBlockRecord } from "@/lib/time-blocks";
import { isWorkspaceEmpty } from "@/lib/workspace-readiness";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

const DATABASE_MIGRATION_REQUIRED_MESSAGE =
  "Dayflow's local database needs an update. Stop Dayflow, run `npm run db:migrate`, then start Dayflow again.";

export async function GET() {
  try {
    return await loadBootstrap();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")
    ) {
      return appErrorResponse(new AppError(bootstrapErrors.migrationRequired));
    }

    console.error("Dayflow bootstrap failed.", error);
    return appErrorResponse(new AppError(bootstrapErrors.openFailed));
  }
}

async function loadBootstrap() {
  const today = startOfLocalDay();
  const reviewPeriod = reviewPeriodRange(today);
  const weekStart = reviewPeriod.start;
  const weekEnd = addDays(today, 2);
  const reviewEnd = reviewPeriod.end;
  const { start, end } = sameDayRange(today);

  const [
    tasks,
    paletteTasks,
    notes,
    diary,
    materials,
    timeBlocks,
    activities,
    weekTasks,
    reviewEvidence,
    savedReview,
    activityCategoryRows,
    workspaceEmpty,
    earliestDayKey
  ] =
    await prisma.$transaction(async (tx) => Promise.all([
      tx.task.findMany({
        where: {
          OR: [
            { date: { gte: weekStart, lt: weekEnd } },
            { date: { lt: today }, status: { not: "DONE" } },
            { date: null },
            { focusQueuePosition: { not: null } }
          ]
        },
        orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
      }),
      tx.task.findMany({
        where: { status: { not: "DONE" } },
        select: {
          id: true,
          title: true,
          date: true,
          estimateMinutes: true,
          sortOrder: true,
          focusQueuePosition: true,
          projectId: true
        }
      }),
      tx.note.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { createdAt: "desc" }
      }),
      tx.diaryEntry.findUnique({ where: { date: start } }),
      tx.material.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      tx.timeBlock.findMany({
        where: { date: { gte: today, lt: weekEnd } },
        orderBy: [
          { date: "asc" },
          { startTime: "asc" },
          { endTime: "asc" },
          { createdAt: "asc" },
          { id: "asc" }
        ],
        include: {
          task: { select: { id: true, title: true, estimateMinutes: true } }
        }
      }),
      tx.activityEntry.findMany({
        where: { startedAt: { gte: start, lt: end } },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
      }),
      tx.task.findMany({
        where: { date: { gte: weekStart, lt: reviewEnd } },
        orderBy: { date: "asc" }
      }),
      readReviewPeriodEvidence(tx, reviewPeriod),
      tx.review.findUnique({
        where: {
          periodStart_periodEnd: {
            periodStart: weekStart,
            periodEnd: reviewEnd
          }
        }
      }),
      tx.activityEntry.findMany({
        select: { category: true },
        distinct: ["category"]
      }),
      isWorkspaceEmpty(tx),
      earliestRecordedDay(tx)
    ]), { timeout: 60000 });

  const diaryEntry = diary
    ? { ...diary, persisted: true }
    : {
      id: null,
      date: start,
      content: "",
      reflection: "",
      mood: 3,
      energy: 3,
      persisted: false
    };
  const { projects, summary: reviewSummary } = reviewEvidence;
  const stats = buildStats(
    weekTasks,
    reviewEvidence.diaries,
    reviewEvidence.activities,
    weekStart
  );
  const review = savedReview
    ? { ...savedReview, persisted: true }
    : {
      id: null,
      periodStart: weekStart,
      periodEnd: reviewEnd,
      narrative: "",
      nextPeriodIntention: "",
      persisted: false
    };

  return NextResponse.json({
    today: start.toISOString(),
    todayKey: localDateKey(start),
    earliestDayKey: resolveEarliestNavigableDayKey(earliestDayKey, start),
    dayViewForwardWeeks: DAY_VIEW_FORWARD_WEEKS,
    tasks,
    paletteTasks,
    notes: notes.map((note) => ({ ...note, tags: safeTags(note.tags) })),
    diary: diaryEntry,
    materials,
    timeBlocks: timeBlocks
      .map(serializeTimeBlock)
      .filter(isTimeBlockRecord),
    activities,
    activityCategorySuggestions: buildActivityCategorySuggestions(
      activityCategoryRows.map(({ category }) => category)
    ),
    projects,
    unfinishedTasks: tasks.filter(
      (task) => task.date && task.date < today && task.status !== "DONE"
    ),
    stats,
    review,
    reviewSummary,
    workspaceEmpty
  });
}

function safeTags(tags: string) {
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

type StatTask = {
  date: Date | null;
  status: string;
  estimateMinutes: number;
};

type StatDiary = {
  date: Date;
  mood: number;
  energy: number;
};

type StatActivity = {
  startedAt: Date;
  durationMinutes: number;
};

function buildStats(
  tasks: StatTask[],
  diaries: StatDiary[],
  activities: StatActivity[],
  weekStart: Date
) {
  const byDay = new Map<string, StatTask[]>();
  for (const task of tasks) {
    if (!task.date) continue;
    const key = localDateKey(task.date);
    byDay.set(key, [...(byDay.get(key) ?? []), task]);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const day = localDateKey(addDays(weekStart, index));
    const dayTasks = byDay.get(day) ?? [];
    const done = dayTasks.filter((task) => task.status === "DONE").length;
    const diary = diaries.find((entry) => localDateKey(entry.date) === day);
    const dayActivities = activities.filter((entry) => localDateKey(entry.startedAt) === day);
    const recordedMinutes = dayActivities.reduce(
      (sum, entry) => sum + entry.durationMinutes,
      0
    );
    return {
      day,
      completed: done,
      total: dayTasks.length,
      completionRate: dayTasks.length ? Math.round((done / dayTasks.length) * 100) : 0,
      plannedHours: roundHours(dayTasks.reduce((sum, task) => sum + task.estimateMinutes, 0)),
      actualHours: roundHours(recordedMinutes),
      mood: diary?.mood ?? null,
      energy: diary?.energy ?? null
    };
  });
}

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}
