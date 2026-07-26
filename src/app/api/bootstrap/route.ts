import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, sameDayRange, startOfLocalDay } from "@/lib/dates";
import { listProjectSummaries } from "@/lib/projects";

export async function GET() {
  const today = startOfLocalDay();
  const weekStart = addDays(today, -6);
  const weekEnd = addDays(today, 2);
  const reviewEnd = addDays(today, 1);
  const { start, end } = sameDayRange(today);

  const [
    tasks,
    notes,
    diary,
    materials,
    timeBlocks,
    activities,
    weekTasks,
    diaries,
    weekActivities,
    weekFocusSessions,
    projects
  ] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          OR: [
            { date: { gte: weekStart, lt: weekEnd } },
            { date: { lt: today }, status: { not: "DONE" } },
            { date: null }
          ]
        },
        orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
      }),
      prisma.note.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.diaryEntry.findUnique({ where: { date: start } }),
      prisma.material.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      prisma.timeBlock.findMany({
        where: { date: { gte: today, lt: weekEnd } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }]
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
        orderBy: { startedAt: "asc" }
      }),
      prisma.focusSession.findMany({
        where: {
          kind: "FOCUS",
          completedAt: { gte: weekStart, lt: reviewEnd },
          status: { in: ["COMPLETED", "CANCELED"] }
        },
        select: {
          status: true,
          actualMinutes: true,
          startedAt: true
        }
      }),
      listProjectSummaries()
    ]);

  const diaryEntry =
    diary ??
    (await prisma.diaryEntry.create({
      data: { date: start, content: "", reflection: "", mood: 3, energy: 3 }
    }));
  const stats = buildStats(weekTasks, diaries, weekActivities, weekStart);
  const reviewSummary = {
    ...buildReviewSummary(weekFocusSessions),
    focusedMinutes: weekActivities.reduce(
      (sum, activity) => sum + activity.durationMinutes,
      0
    )
  };

  return NextResponse.json({
    today: start.toISOString(),
    tasks,
    notes: notes.map((note) => ({ ...note, tags: safeTags(note.tags) })),
    diary: diaryEntry,
    materials,
    timeBlocks,
    activities,
    projects,
    unfinishedTasks: tasks.filter(
      (task) => task.date && task.date < today && task.status !== "DONE"
    ),
    stats,
    reviewSummary
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
  actualMinutes: number;
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
    const legacyActualMinutes = dayTasks.reduce((sum, task) => sum + task.actualMinutes, 0);
    return {
      day,
      completed: done,
      total: dayTasks.length,
      completionRate: dayTasks.length ? Math.round((done / dayTasks.length) * 100) : 0,
      plannedHours: roundHours(dayTasks.reduce((sum, task) => sum + task.estimateMinutes, 0)),
      actualHours: roundHours(dayActivities.length ? recordedMinutes : legacyActualMinutes),
      mood: diary?.mood ?? null,
      energy: diary?.energy ?? null
    };
  });
}

function buildReviewSummary(
  sessions: Array<{
    status: string;
    actualMinutes: number;
    startedAt: Date;
  }>
) {
  const completed = sessions.filter((session) => session.status === "COMPLETED");
  const longest =
    [...completed].sort((a, b) => b.actualMinutes - a.actualMinutes)[0] ?? null;
  return {
    focusedMinutes: completed.reduce(
      (sum, session) => sum + session.actualMinutes,
      0
    ),
    completedSessions: completed.length,
    cancelledSessions: sessions.filter(
      (session) => session.status === "CANCELED"
    ).length,
    longestMinutes: longest?.actualMinutes ?? 0,
    longestStartedAt: longest?.startedAt ?? null
  };
}

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
