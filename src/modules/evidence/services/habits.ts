import type { Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { evidenceErrors } from "../domain/activity";
import type {
  CheckInMutation,
  HabitCreateMutation,
  HabitPatchMutation
} from "../domain/habit";

export type HabitMutationAction = "load" | "save" | "check-in";

/**
 * Recognised by shape rather than by importing Prisma as a value, which
 * services may not do. P2025 is "record to update not found", which for these
 * routes means the Habit is gone.
 */
export function translateHabitPersistenceError(error: unknown): unknown {
  if (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    "clientVersion" in error &&
    typeof error.clientVersion === "string" &&
    "code" in error &&
    error.code === "P2025"
  ) {
    return new AppError(evidenceErrors.habitNotFound, error);
  }
  // P2002 must reach runOnce, which replays the original response.
  return error;
}

export function createHabit(
  tx: Prisma.TransactionClient,
  input: HabitCreateMutation
) {
  return tx.habit.create({ data: input });
}

export function readHabit(tx: Prisma.TransactionClient, id: string) {
  return tx.habit.findUnique({ where: { id } });
}

export function readActiveHabits(tx: Prisma.TransactionClient) {
  return tx.habit.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

export function updateHabit(
  tx: Prisma.TransactionClient,
  id: string,
  patch: HabitPatchMutation
) {
  return tx.habit.update({ where: { id }, data: patch });
}

/**
 * Archiving keeps every Check-in. A Habit is never deleted, so the record of
 * what happened cannot be destroyed by removing the thing it described.
 */
export function archiveHabit(
  tx: Prisma.TransactionClient,
  id: string,
  now: Date
) {
  return tx.habit.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: now }
  });
}

/**
 * One Check-in per Habit per day, enforced by the unique index rather than by
 * a read-then-write, so a repeated request cannot create a second row.
 */
export function upsertCheckIn(
  tx: Prisma.TransactionClient,
  habitId: string,
  input: CheckInMutation
) {
  return tx.habitCheckIn.upsert({
    where: { habitId_date: { habitId, date: input.date } },
    create: { habitId, ...input },
    update: { done: input.done, amount: input.amount, note: input.note }
  });
}

export function readCheckIns(
  tx: Prisma.TransactionClient,
  range: { start: Date; end: Date }
) {
  return tx.habitCheckIn.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    orderBy: { date: "asc" }
  });
}

export function readHabitCheckIns(
  tx: Prisma.TransactionClient,
  habitId: string,
  range: { start: Date; end: Date }
) {
  return tx.habitCheckIn.findMany({
    where: { habitId, date: { gte: range.start, lt: range.end } },
    orderBy: { date: "asc" }
  });
}
