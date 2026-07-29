import { NextResponse } from "next/server";
import { buildActivityCategorySuggestions } from "@/lib/activity-categories";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  localDateKey,
  reviewPeriodRange,
  sameDayRange,
  startOfLocalDay
} from "@/lib/dates";
import { listProjectSummaries } from "@/lib/projects";
import { buildReviewSummary } from "@/lib/review-domain";
import { serializeTimeBlock } from "@/lib/time-block-persistence";
import { isTimeBlockRecord } from "@/lib/time-blocks";
import { isWorkspaceEmpty } from "@/lib/workspace-readiness";

export async function GET() {
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
    diaries,
    weekActivities,
    completedTasks,
    reviewNotes,
    reviewMaterials,
    projects,
    savedReview,
    activityCategoryRows,
    workspaceEmpty
  ] =
    await Promise.all([
      prisma.task.findMany({
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
      prisma.task.findMany({
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
      prisma.note.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.diaryEntry.findUnique({ where: { date: start } }),
      prisma.material.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      prisma.timeBlock.findMany({
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
      prisma.activityEntry.findMany({
        where: { startedAt: { gte: start, lt: end } },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
      }),
      prisma.task.findMany({
        where: { date: { gte: weekStart, lt: reviewEnd } },
        orderBy: { date: "asc" }
      }),
      prisma.diaryEntry.findMany({
        where: { date: { gte: weekStart, lt: reviewEnd } },
        orderBy: { date: "asc" }
      }),
      prisma.activityEntry.findMany({
        where: { startedAt: { gte: weekStart, lt: reviewEnd } },
        orderBy: { startedAt: "asc" },
        include: {
          focusSession: {
            select: {
              needsEnrichment: true
            }
          }
        }
      }),
      prisma.task.findMany({
        where: { completedAt: { gte: weekStart, lt: reviewEnd } },
        select: { id: true }
      }),
      prisma.note.findMany({
        where: { date: { gte: weekStart, lt: reviewEnd } },
        select: { id: true }
      }),
      prisma.material.findMany({
        where: { createdAt: { gte: weekStart, lt: reviewEnd } },
        select: { id: true }
      }),
      listProjectSummaries(reviewPeriod),
      prisma.review.findUnique({
        where: {
          periodStart_periodEnd: {
            periodStart: weekStart,
            periodEnd: reviewEnd
          }
        }
      }),
      prisma.activityEntry.findMany({
        select: { category: true },
        distinct: ["category"]
      }),
      isWorkspaceEmpty(prisma)
    ]);

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
  const stats = buildStats(
    weekTasks,
    diaries,
    weekActivities,
    weekStart
  );
  const reviewSummary = {
    ...buildReviewSummary({
      activities: weekActivities,
      completedTasks,
      notes: reviewNotes,
      materials: reviewMaterials,
      diaries
    }),
    movedProjectCount: projects.filter(
      (project) => project.movedDuringReviewPeriod
    ).length
  };
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
