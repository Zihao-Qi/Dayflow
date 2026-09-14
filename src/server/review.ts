import type { Prisma, PrismaClient } from "@prisma/client";
// The reads carry an explicit budget. Prisma's default is five seconds, which
// concurrent Review reads exhausted: the route returned its could-not-be-read
// envelope and main went red twice on 2026-09-13 with P2028 and P1008. Bootstrap
// and agent export already set the same value.
//
// saveReview deliberately keeps the default. It is a write, and a SQLite write
// transaction holds an exclusive lock: a sixty-second ceiling there would let one
// slow save block every concurrent write rather than fail fast. Every other write
// in the tree uses the default for the same reason.
import { calendar } from "@/lib/time";
import { AppError } from "@/shared/kernel/errors";
import {
  assertCurrentReviewPeriod, isReviewIdentifier, reviewErrors, parseReviewHistoryPage,
  parseReviewWindowRequest, parseCurrentReviewWindowRequest, type ReviewMutation
} from "@/modules/review/domain/review";
import * as reviews from "@/modules/review/services/reviews";
import { withTransaction } from "@/server/prisma/client";

export { readSavedReview, readReviewPeriodEvidence, readResolvedReviewWindow } from "@/modules/review/services/reviews";

export function saveReview(database: PrismaClient, input: ReviewMutation, now: Date) {
  // Preserve validation before storage access; the service also enforces the rule.
  assertCurrentReviewPeriod(input, now, calendar);
  return withTransaction(database, tx => reviews.saveReview(tx, input, now, calendar));
}

export function readReviewHistoryPage(database: PrismaClient, searchParams: URLSearchParams, now: Date) {
  parseReviewHistoryPage(searchParams);
  return withTransaction(database, tx => reviews.readReviewHistoryPage(tx, searchParams, now, calendar), { timeout: 60000 });
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
  return withTransaction(database, tx => reviews.readReviewWindow(tx, searchParams, now, calendar), { timeout: 60000 });
}

/** Legacy callers may already own a read transaction. */
export function readPastReviewPeriod(database: Prisma.TransactionClient, id: string, now: Date) {
  return reviews.readPastReviewPeriod(database, id, now, calendar);
}

/** Route read root; the stored bounds, evidence, and project metrics share one snapshot. */
export function loadPastReviewPeriod(database: PrismaClient, id: string, now: Date) {
  if (!isReviewIdentifier(id)) throw new AppError(reviewErrors.thatReviewIdentifierIsNotValid);
  return withTransaction(database, tx => reviews.readPastReviewPeriod(tx, id, now, calendar), { timeout: 60000 });
}
