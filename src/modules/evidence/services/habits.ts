import type { Prisma } from "@prisma/client";
import type {
  CheckInMutation,
  HabitCreateMutation,
  HabitPatchMutation
} from "../domain/habit";

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
