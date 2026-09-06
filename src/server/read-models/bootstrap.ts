import { readDayNotes, readRecentMaterials } from "@/server/journal";
import { readDayActivities, readDiary, readActivityCategories } from "@/server/evidence";
import { calendar } from "@/lib/time";
import { buildActivityCategorySuggestions } from "@/lib/activity-categories";
import {
  addDays,
  localDateKey,
  sameDayRange
} from "@/lib/dates";
import {
  DAY_VIEW_FORWARD_WEEKS,
  earliestRecordedDay,
  resolveEarliestNavigableDayKey
} from "@/lib/day-view";
import { readReviewPeriodEvidence, readSavedReview } from "@/server/review";
import { readTimeBlocks } from "@/server/time-blocks";
import { isWorkspaceEmpty } from "@/server/read-models/workspace-readiness";
import type { Prisma } from "@prisma/client";
import { readTaskWindow, readOpenTaskPalette, readTasksInDateRange } from "@/modules/planning/services/tasks";

/** Compose the bootstrap payload inside the caller's read transaction. */
export async function readBootstrap(tx: Prisma.TransactionClient, now: Date) {
  const today = calendar.startOf(calendar.dayOf(now));
  const reviewPeriod = calendar.reviewPeriodEnding(calendar.dayOf(now));
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
  ] = await Promise.all([
    readTaskWindow(tx, { start: weekStart, end: weekEnd }, today),
    readOpenTaskPalette(tx),
    readDayNotes(tx, { start, end }),
    readDiary(tx, start),
    readRecentMaterials(tx),
    readTimeBlocks(tx, { start: today, end: weekEnd }, "range"),
    readDayActivities(tx, { start, end }),
    readTasksInDateRange(tx, { start: weekStart, end: reviewEnd }),
    readReviewPeriodEvidence(tx, reviewPeriod),
    readSavedReview(tx, reviewPeriod),
    readActivityCategories(tx),
    isWorkspaceEmpty(tx),
    earliestRecordedDay(tx)
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

  return {
    today: start.toISOString(),
    todayKey: localDateKey(start),
    earliestDayKey: resolveEarliestNavigableDayKey(earliestDayKey, start),
    dayViewForwardWeeks: DAY_VIEW_FORWARD_WEEKS,
    tasks,
    paletteTasks,
    notes: notes.map((note) => ({ ...note, tags: safeTags(note.tags) })),
    diary: diaryEntry,
    materials,
    timeBlocks,
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
  };
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
