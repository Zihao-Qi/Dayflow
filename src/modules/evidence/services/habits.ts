import type { Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { evidenceErrors } from "../domain/activity";
import {
  targetForCadence,
  type CheckInMutation,
  type HabitCreateMutation,
  type HabitPatchMutation
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

/**
 * Habits as they stood during a past period: still active, or archived only
 * after it began. Reading the active list instead would quietly erase a Habit
 * from every historical review the moment it was retired.
 */
export function readHabitsActiveDuring(
  tx: Prisma.TransactionClient,
  period: { start: Date; end: Date }
) {
  return tx.habit.findMany({
    where: {
      createdAt: { lt: period.end },
      OR: [{ status: "ACTIVE" }, { archivedAt: { gte: period.start } }]
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

/**
 * A daily Habit always stores a target of 7. The parser can only enforce that
 * when the patch carries a cadence, so a target-only patch is normalised here
 * against the stored cadence; otherwise `PATCH {targetPerWeek: 1}` would leave
 * a DAILY row contradicting its own invariant.
 */
export async function updateHabit(
  tx: Prisma.TransactionClient,
  id: string,
  patch: HabitPatchMutation
) {
  const stored = await tx.habit.findUnique({ where: { id } });
  if (!stored) throw new AppError(evidenceErrors.habitNotFound);
  const cadence = patch.cadence ?? stored.cadence;
  const data =
    patch.targetPerWeek === undefined && patch.cadence === undefined
      ? patch
      : {
        ...patch,
        targetPerWeek: targetForCadence(
          cadence,
          patch.targetPerWeek ?? stored.targetPerWeek
        )
      };
  return tx.habit.update({ where: { id }, data });
}

/**
 * Archiving keeps every Check-in. A Habit is never deleted, so the record of
 * what happened cannot be destroyed by removing the thing it described.
 */
export async function archiveHabit(
  tx: Prisma.TransactionClient,
  id: string,
  now: Date
) {
  const stored = await tx.habit.findUnique({ where: { id } });
  if (!stored) throw new AppError(evidenceErrors.habitNotFound);
  // Archiving twice must not move the boundary. `readHabitsActiveDuring` uses
  // archivedAt to decide which past periods contain the Habit, so overwriting
  // it would make a retired Habit reappear in reviews it had left.
  if (stored.status === "ARCHIVED") return stored;
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
  const update: Prisma.HabitCheckInUpdateInput = { done: input.done };
  if (input.amount !== undefined) update.amount = input.amount;
  if (input.note !== undefined) update.note = input.note;

  return tx.habitCheckIn.upsert({
    where: { habitId_date: { habitId, date: input.date } },
    create: {
      habitId,
      date: input.date,
      done: input.done,
      amount: input.amount ?? null,
      note: input.note ?? null
    },
    update
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
