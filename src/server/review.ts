import type { Prisma, PrismaClient } from "@prisma/client";
import { calendar } from "@/lib/time";
import { AppError } from "@/shared/kernel/errors";
import {
  assertCurrentReviewPeriod, isReviewIdentifier, reviewErrors, parseReviewHistoryPage,
  parseReviewWindowRequest, parseCurrentReviewWindowRequest, type ReviewMutation
} from "@/modules/review/domain/review";
import * as reviews from "@/modules/review/services/reviews";

export { readSavedReview, readReviewPeriodEvidence, readResolvedReviewWindow } from "@/modules/review/services/reviews";

export function saveReview(database: PrismaClient, input: ReviewMutation, now: Date) {
  // Preserve validation before storage access; the service also enforces the rule.
  assertCurrentReviewPeriod(input, now, calendar);
  return database.$transaction(tx => reviews.saveReview(tx, input, now, calendar));
}

export function readReviewHistoryPage(database: PrismaClient, searchParams: URLSearchParams, now: Date) {
  parseReviewHistoryPage(searchParams);
  return database.$transaction(tx => reviews.readReviewHistoryPage(tx, searchParams, now, calendar));
}

/** Legacy reads retain their transaction-capable signature. */
export function readReviewWindow(database: Prisma.TransactionClient, searchParams: URLSearchParams, now: Date) {
  return reviews.readReviewWindow(database, searchParams, now, calendar);
}

export function readCurrentReviewWindow(database: Prisma.TransactionClient, searchParams: URLSearchParams, now: Date) {
  return reviews.readCurrentReviewWindow(database, searchParams, now, calendar);
}

export function loadReviewWindow(database: PrismaClient, searchParams: URLSearchParams, now: Date) {
  if (searchParams.has("current")) parseCurrentReviewWindowRequest(searchParams, now, calendar);
  else parseReviewWindowRequest(searchParams, now, calendar);
  return database.$transaction(tx => reviews.readReviewWindow(tx, searchParams, now, calendar));
}

/** Legacy callers may already own a read transaction. */
export function readPastReviewPeriod(database: Prisma.TransactionClient, id: string, now: Date) {
  return reviews.readPastReviewPeriod(database, id, now, calendar);
}

/** Route read root; the stored bounds, evidence, and project metrics share one snapshot. */
export function loadPastReviewPeriod(database: PrismaClient, id: string, now: Date) {
  if (!isReviewIdentifier(id)) throw new AppError(reviewErrors.thatReviewIdentifierIsNotValid);
  return database.$transaction(tx => reviews.readPastReviewPeriod(tx, id, now, calendar));
}
