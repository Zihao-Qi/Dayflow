import { readReviewActivities, readReviewDiaries } from "@/server/evidence";
import {
  addDays,
  localDateKey,
  parseLocalDate,
  reviewPeriodRange,
  startOfLocalDay
} from "@/lib/dates";
import { listProjectSummaries } from "@/server/read-models/project-summaries";
import { buildReviewSummary } from "@/lib/review-domain";
import { reviewErrors } from "@/lib/review-errors";
import { AppError } from "@/shared/kernel/errors";
import type { Prisma, PrismaClient } from "@prisma/client";

export const REVIEW_HISTORY_DEFAULT_LIMIT = 20;
export const REVIEW_HISTORY_MAX_LIMIT = 100;
const REVIEW_CURSOR_MAX_LENGTH = 1_024;

export type ReviewHistoryErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CURSOR"
  | "REVIEW_NOT_FOUND";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as ReviewHistoryRequestError };

export type ReviewPeriodInterval = {
  start: Date;
  end: Date;
};

export type ReviewCursor = {
  periodStart: Date;
  id: string;
};

export type ReviewWindowRequest = ReviewPeriodInterval & {
  ending: string;
};

/**
 * Derive a Review Summary for one resolved interval.
 *
 * This deliberately knows nothing about how the interval was chosen, so the
 * current Review Period, a saved Review's stored window, and any future
 * anchor-day window all produce their summaries through one code path.
 */
export async function readReviewPeriodEvidence(
  database: Prisma.TransactionClient,
  period: ReviewPeriodInterval
) {
  const window = { gte: period.start, lt: period.end };

  const [activities, diaries, completedTasks, notes, materials, projects] =
    await Promise.all([
      readReviewActivities(database, period),
      readReviewDiaries(database, period),
      database.task.findMany({
        where: { completedAt: window },
        select: { id: true }
      }),
      database.note.findMany({
        where: { date: window },
        select: { id: true }
      }),
      database.material.findMany({
        where: { createdAt: window },
        select: { id: true }
      }),
      listProjectSummaries(database, period)
    ]);

  const summary = {
    ...buildReviewSummary({
      activities,
      completedTasks,
      notes,
      materials,
      diaries
    }),
    movedProjectCount: projects.filter(
      (project) => project.movedDuringReviewPeriod
    ).length
  };

  return { activities, diaries, completedTasks, notes, materials, projects, summary };
}

export function parseReviewWindowRequest(
  searchParams: URLSearchParams,
  now: Date
): ReviewWindowRequest {
  const values = searchParams.getAll("ending");
  if (values.length !== 1) {
    throw new AppError(values.length ? reviewErrors.multipleWindowEndingDays : reviewErrors.windowEndingDayRequired);
  }

  const ending = values[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ending)) {
    throw new AppError(reviewErrors.aReviewWindowEndingDayMustBeACalendarDateSuch);
  }

  const endingDay = parseLocalDate(ending);
  if (!endingDay || localDateKey(endingDay) !== ending) {
    throw new AppError(reviewErrors.thatReviewWindowEndingDayIsNotARealCalendarDate);
  }
  if (endingDay.getTime() >= startOfLocalDay(now).getTime()) {
    throw new AppError(reviewErrors.reviewWindowsMustEndBeforeToday);
  }

  return {
    ending,
    start: addDays(endingDay, -6),
    end: addDays(endingDay, 1)
  };
}

export async function readReviewWindow(
  database: Prisma.TransactionClient,
  searchParams: URLSearchParams,
  now: Date
) {
  return readResolvedReviewWindow(database, parseReviewWindowRequest(searchParams, now));
}

export async function readResolvedReviewWindow(database: Prisma.TransactionClient, window: ReviewWindowRequest) {
  const period = { start: window.start, end: window.end };
  const [{ summary, projects }, review] = await Promise.all([
    readReviewPeriodEvidence(database, period),
    database.review.findUnique({
      where: {
        periodStart_periodEnd: {
          periodStart: period.start,
          periodEnd: period.end
        }
      }
    })
  ]);

  return {
    ending: window.ending,
    periodStart: period.start,
    periodEnd: period.end,
    review: review ? { ...review, persisted: true } : null,
    reviewSummary: summary,
    projects
  };
}

export function parseReviewHistoryPage(searchParams: URLSearchParams) {
  const limitValues = searchParams.getAll("limit");
  if (limitValues.length > 1) {
    throw new AppError(reviewErrors.provideOnlyOnePageLimit);
  }

  let limit = REVIEW_HISTORY_DEFAULT_LIMIT;
  if (limitValues.length === 1) {
    const raw = limitValues[0].trim();
    const parsed = Number(raw);
    if (
      !raw ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > REVIEW_HISTORY_MAX_LIMIT
    ) {
      throw new AppError(reviewErrors.pageLimitMustBeAWholeNumberBetween1And100);
    }
    limit = parsed;
  }

  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    throw new AppError(reviewErrors.provideOnlyOnePaginationCursor);
  }

  return {
    limit,
    cursor: cursorValues.length === 1 ? decodeReviewCursor(cursorValues[0]) : null
  };
}

export function encodeReviewCursor(value: ReviewCursor) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind: "review",
      periodStart: value.periodStart.toISOString(),
      id: value.id
    }),
    "utf8"
  ).toString("base64url");
}

export function decodeReviewCursor(value: string): ReviewCursor {
  try {
    if (
      !value.length ||
      value.length > REVIEW_CURSOR_MAX_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new Error("malformed cursor");
    }
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (
      decoded.version !== 1 ||
      decoded.kind !== "review" ||
      typeof decoded.periodStart !== "string" ||
      typeof decoded.id !== "string" ||
      !decoded.id
    ) {
      throw new Error("unsupported cursor");
    }
    const periodStart = new Date(decoded.periodStart);
    if (Number.isNaN(periodStart.getTime())) {
      throw new Error("invalid cursor period");
    }
    return { periodStart, id: decoded.id };
  } catch {
    throw new AppError(reviewErrors.thatPaginationCursorIsNoLongerUsableReloadReviewHistory);
  }
}

/**
 * List saved Reviews for Past Review Periods, newest first.
 *
 * The current Review Period is excluded: it stays editable in the Review
 * workspace and is never part of history.
 */
export async function readReviewHistoryPage(
  database: PrismaClient,
  searchParams: URLSearchParams,
  now: Date
) {
  const { limit, cursor } = parseReviewHistoryPage(searchParams);
  const current = reviewPeriodRange(now);
  const pastPeriods = { periodEnd: { lt: current.end } };

  const [records, totalCount] = await Promise.all([
    database.review.findMany({
      where: cursor
        ? {
          AND: [
            pastPeriods,
            {
              OR: [
                { periodStart: { lt: cursor.periodStart } },
                {
                  periodStart: cursor.periodStart,
                  id: { lt: cursor.id }
                }
              ]
            }
          ]
        }
        : pastPeriods,
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
      take: limit + 1
    }),
    database.review.count({ where: pastPeriods })
  ]);

  const items = records.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    totalCount,
    nextCursor:
      records.length > limit && last
        ? encodeReviewCursor({ periodStart: last.periodStart, id: last.id })
        : null
  };
}

export function isReviewIdentifier(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * Read one saved Review together with the summary derived for its own stored
 * window. Reading never writes.
 */
export async function readPastReviewPeriod(
  database: Prisma.TransactionClient,
  id: string,
  now: Date
) {
  if (!isReviewIdentifier(id)) {
    throw new AppError(reviewErrors.thatReviewIdentifierIsNotValid);
  }

  const review = await database.review.findUnique({ where: { id } });
  if (!review) {
    throw new AppError(reviewErrors.thatReviewNoLongerExists);
  }

  const period = { start: review.periodStart, end: review.periodEnd };
  const { summary, projects } = await readReviewPeriodEvidence(database, period);
  const current = reviewPeriodRange(now);

  return {
    review: { ...review, persisted: true },
    reviewSummary: summary,
    projects,
    isCurrentPeriod:
      review.periodStart.getTime() === current.start.getTime() &&
      review.periodEnd.getTime() === current.end.getTime()
  };
}
