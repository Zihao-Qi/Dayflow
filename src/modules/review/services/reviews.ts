import type { Prisma } from "@prisma/client";
import type { Calendar } from "@/shared/kernel/calendar";
import { AppError } from "@/shared/kernel/errors";
import { readReviewNotes } from "@/modules/journal/services/notes";
import { readReviewMaterials } from "@/modules/journal/services/materials";
import { readReviewActivities, readProjectActivitySummaries } from "@/modules/evidence/services/activities";
import { readReviewDiaries } from "@/modules/evidence/services/diary";
import { readReviewCompletedTasks, readProjectTasks } from "@/modules/planning/services/tasks";
import { readProjects } from "@/modules/projects/services/projects";
import { summarizeProjects } from "@/modules/projects/domain/project";
import {
  assertCurrentReviewPeriod, buildReviewSummary, reviewErrors, parseReviewWindowRequest,
  parseCurrentReviewWindowRequest, parseReviewHistoryPage, encodeReviewCursor, isReviewIdentifier,
  type ReviewMutation, type ReviewPeriodInterval, type ReviewWindowRequest
} from "../domain/review";

export async function saveReview(tx: Prisma.TransactionClient, input: ReviewMutation, now: Date, calendar: Calendar) {
  assertCurrentReviewPeriod(input, now, calendar);
  const review = await tx.review.upsert({
    where: { periodStart_periodEnd: { periodStart: input.periodStart, periodEnd: input.periodEnd } },
    create: input,
    update: { narrative: input.narrative, nextPeriodIntention: input.nextPeriodIntention }
  });
  return { ...review, persisted: true as const };
}

export function readSavedReview(database: { review: Pick<Prisma.TransactionClient["review"], "findUnique"> }, period: ReviewPeriodInterval) {
  return database.review.findUnique({
    where: { periodStart_periodEnd: { periodStart: period.start, periodEnd: period.end } }
  });
}

/** Review owns the reads; pure project-summary composition is shared in the domain.
 * Modules cannot import server read models. */
async function readReviewProjects(database: Prisma.TransactionClient, reviewPeriod: ReviewPeriodInterval) {
  const projects = await readProjects(database);
  if (!projects.length) return [];
  const ids = projects.map(project => project.id);
  const [tasks, activities] = await Promise.all([
    readProjectTasks(database, ids), readProjectActivitySummaries(database, ids)
  ]);
  return summarizeProjects(projects, tasks, activities, reviewPeriod);
}

export async function readReviewPeriodEvidence(
  database: Prisma.TransactionClient,
  period: ReviewPeriodInterval
) {
  const [activities, diaries, completedTasks, notes, materials, projects] =
    await Promise.all([
      readReviewActivities(database, period),
      readReviewDiaries(database, period),
      readReviewCompletedTasks(database, period),
      readReviewNotes(database, period),
      readReviewMaterials(database, period),
      readReviewProjects(database, period)
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

export async function readReviewWindow(database: Prisma.TransactionClient, searchParams: URLSearchParams, now: Date, calendar: Calendar) {
  if (searchParams.has("current")) return readCurrentReviewWindow(database, searchParams, now, calendar);
  return readResolvedReviewWindow(database, parseReviewWindowRequest(searchParams, now, calendar));
}

export async function readCurrentReviewWindow(database: Prisma.TransactionClient, searchParams: URLSearchParams, now: Date, calendar: Calendar) {
  const window = parseCurrentReviewWindowRequest(searchParams, now, calendar);
  const detail = await readResolvedReviewWindow(database, window);
  return {
    ...detail,
    review: detail.review ?? {
      id: null, periodStart: window.start, periodEnd: window.end,
      narrative: "", nextPeriodIntention: "", persisted: false
    }
  };
}

export async function readResolvedReviewWindow(database: Prisma.TransactionClient, window: ReviewWindowRequest) {
  const period = { start: window.start, end: window.end };
  const [{ summary, projects }, review] = await Promise.all([
    readReviewPeriodEvidence(database, period),
    readSavedReview(database, period)
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

export async function readReviewHistoryPage(
  database: Prisma.TransactionClient,
  searchParams: URLSearchParams,
  now: Date,
  calendar: Calendar
) {
  const { limit, cursor } = parseReviewHistoryPage(searchParams);
  const current = calendar.reviewPeriodEnding(calendar.dayOf(now));
  const pastPeriods = { periodEnd: { lt: current.end } };

  const records = await database.review.findMany({
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
  });
  const totalCount = await database.review.count({ where: pastPeriods });

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

export async function readPastReviewPeriod(
  database: Prisma.TransactionClient,
  id: string,
  now: Date,
  calendar: Calendar
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
  const current = calendar.reviewPeriodEnding(calendar.dayOf(now));

  return {
    review: { ...review, persisted: true },
    reviewSummary: summary,
    projects,
    isCurrentPeriod:
      review.periodStart.getTime() === current.start.getTime() &&
      review.periodEnd.getTime() === current.end.getTime()
  };
}
