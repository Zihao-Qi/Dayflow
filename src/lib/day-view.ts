import type { PrismaClient } from "@prisma/client";
import { addDays, localDateKey, parseLocalDate, sameDayRange, startOfLocalDay } from "@/lib/dates";
import { serializeTimeBlock } from "@/lib/time-block-persistence";
import { isTimeBlockRecord } from "@/lib/time-blocks";

/**
 * How far ahead Log may travel.
 *
 * A product statement rather than a performance limit: Dayflow thinks in days
 * and weeks, so a longer horizon would imply a planner this is not. Scheduling
 * a Task for a distant date stays unbounded.
 *
 * Contract: docs/specs/DAY_NAVIGATION_V1.md
 */
export const DAY_VIEW_FORWARD_WEEKS = 8;
const FORWARD_DAYS = DAY_VIEW_FORWARD_WEEKS * 7;

export type DayViewKind = "past" | "today" | "future";

export type DayViewErrorCode = "VALIDATION_ERROR";

export class DayViewRequestError extends Error {
  constructor(
    readonly code: DayViewErrorCode,
    message: string,
    readonly field: string,
    readonly status: 400 = 400
  ) {
    super(message);
    this.name = "DayViewRequestError";
  }
}

export function classifyDay(date: Date, now = new Date()): DayViewKind {
  const today = startOfLocalDay(now).getTime();
  const day = startOfLocalDay(date).getTime();
  if (day < today) return "past";
  if (day > today) return "future";
  return "today";
}

/**
 * Resolve the requested day, rejecting rather than clamping.
 *
 * Clamping would silently show a different day than the one asked for, which
 * is the failure mode this whole feature exists to avoid.
 */
export function parseViewedDay(
  searchParams: URLSearchParams,
  now = new Date()
) {
  const values = searchParams.getAll("date");
  if (values.length > 1) {
    throw new DayViewRequestError(
      "VALIDATION_ERROR",
      "Provide only one day.",
      "date"
    );
  }
  const today = startOfLocalDay(now);
  if (values.length === 0) {
    return { date: today, kind: "today" as DayViewKind };
  }

  const raw = values[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new DayViewRequestError(
      "VALIDATION_ERROR",
      "A day must be a calendar date such as 2026-08-23.",
      "date"
    );
  }
  const date = parseLocalDate(raw);
  if (!date || localDateKey(date) !== raw) {
    throw new DayViewRequestError(
      "VALIDATION_ERROR",
      "That day is not a real calendar date.",
      "date"
    );
  }
  if (date.getTime() > addDays(today, FORWARD_DAYS).getTime()) {
    throw new DayViewRequestError(
      "VALIDATION_ERROR",
      `Dayflow plans up to ${DAY_VIEW_FORWARD_WEEKS} weeks ahead.`,
      "date"
    );
  }

  return { date, kind: classifyDay(date, now) };
}

export function resolveEarliestNavigableDayKey(
  earliestRecordedDayKey: string | null,
  now = new Date()
) {
  const todayKey = localDateKey(startOfLocalDay(now));
  return earliestRecordedDayKey && earliestRecordedDayKey < todayKey
    ? earliestRecordedDayKey
    : todayKey;
}

export function assertViewedDayOnOrAfter(
  date: Date,
  earliestDayKey: string
) {
  const earliest = parseLocalDate(earliestDayKey);
  if (!earliest || date.getTime() < earliest.getTime()) {
    throw new DayViewRequestError(
      "VALIDATION_ERROR",
      "That day is earlier than Dayflow's first recorded evidence.",
      "date"
    );
  }
}

/**
 * Read one day.
 *
 * A future day carries no Activity at all. Evidence of a day that has not
 * happened does not exist, so it is absent rather than empty.
 */
export async function readViewedDay(
  database: PrismaClient,
  date: Date,
  now = new Date()
) {
  const kind = classifyDay(date, now);
  const { start, end } = sameDayRange(date);

  const [tasks, timeBlocks, activities] = await Promise.all([
    database.task.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    }),
    database.timeBlock.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [
        { startTime: "asc" },
        { endTime: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ],
      include: {
        task: { select: { id: true, title: true, estimateMinutes: true } }
      }
    }),
    kind === "future"
      ? Promise.resolve([])
      : database.activityEntry.findMany({
          where: { startedAt: { gte: start, lt: end } },
          orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
        })
  ]);

  return {
    dateKey: localDateKey(date),
    kind,
    tasks,
    timeBlocks: timeBlocks.map(serializeTimeBlock).filter(isTimeBlockRecord),
    activities
  };
}

/**
 * The earliest day worth navigating back to. Null when nothing is persisted.
 */
export async function earliestRecordedDay(database: PrismaClient) {
  const [task, activity, block] = await Promise.all([
    database.task.findFirst({
      where: { date: { not: null } },
      orderBy: { date: "asc" },
      select: { date: true }
    }),
    database.activityEntry.findFirst({
      orderBy: { startedAt: "asc" },
      select: { startedAt: true }
    }),
    database.timeBlock.findFirst({
      orderBy: { date: "asc" },
      select: { date: true }
    })
  ]);

  const candidates = [task?.date, activity?.startedAt, block?.date]
    .filter((value): value is Date => Boolean(value))
    .map((value) => startOfLocalDay(value).getTime());
  return candidates.length ? localDateKey(new Date(Math.min(...candidates))) : null;
}
