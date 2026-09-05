import { appErrorConstructor } from "@/lib/error-compat";
import { focusQueueErrors } from "@/lib/focus-queue-errors";
import { prisma } from "@/lib/prisma";
import { AppError, validation } from "@/shared/kernel/errors";
import { Prisma, TaskStatus } from "@prisma/client";

type QueueTransaction = Prisma.TransactionClient;
export type QueuePlacement = "next" | "end";

const queueOrder = [
  { focusQueuePosition: "asc" as const },
  { createdAt: "asc" as const }
];

export async function listFocusQueue(transaction: QueueTransaction) {
  return transaction.task.findMany({
    where: {
      focusQueuePosition: { not: null },
      status: { not: TaskStatus.DONE }
    },
    orderBy: queueOrder
  });
}

export async function addToFocusQueue(
  taskId: string,
  placement: QueuePlacement
) {
  return prisma.$transaction(async (transaction) => {
    const task = await transaction.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true }
    });
    if (!task) throw new AppError(focusQueueErrors.taskNotFound);
    if (task.status === TaskStatus.DONE) {
      throw new AppError(focusQueueErrors.completedTasksCannotBeQueued);
    }

    const current = await queueIds(transaction);
    const withoutTask = current.filter((id) => id !== taskId);
    const ids =
      placement === "next"
        ? [taskId, ...withoutTask]
        : [...withoutTask, taskId];
    await writeQueueOrder(transaction, ids);
    return listFocusQueue(transaction);
  });
}

export async function reorderFocusQueue(
  ids: string[],
  expectedIds: string[]
) {
  return prisma.$transaction(async (transaction) => {
    const current = await queueIds(transaction);
    if (
      !sameOrder(current, expectedIds) ||
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      current.some((id) => !ids.includes(id))
    ) {
      throw new AppError(focusQueueErrors.queueOrderIsOutOfDateRefreshAndTryAgain);
    }
    await writeQueueOrder(transaction, ids);
    return listFocusQueue(transaction);
  });
}

export async function removeFromFocusQueue(taskId: string) {
  return prisma.$transaction(async (transaction) => {
    const current = await queueIds(transaction);
    if (!current.includes(taskId)) return listFocusQueue(transaction);
    await writeQueueOrder(
      transaction,
      current.filter((id) => id !== taskId)
    );
    return listFocusQueue(transaction);
  });
}

export async function consumeFocusQueueTask(
  transaction: QueueTransaction,
  taskId: string
) {
  const task = await transaction.task.findUnique({
    where: { id: taskId },
    select: { focusQueuePosition: true }
  });
  if (task?.focusQueuePosition === null || task?.focusQueuePosition === undefined) {
    return;
  }
  await transaction.task.update({
    where: { id: taskId },
    data: { focusQueuePosition: null }
  });
  await compactFocusQueue(transaction);
}

export async function compactFocusQueue(transaction: QueueTransaction) {
  await writeQueueOrder(transaction, await queueIds(transaction));
}

async function queueIds(transaction: QueueTransaction) {
  const tasks = await transaction.task.findMany({
    where: {
      focusQueuePosition: { not: null },
      status: { not: TaskStatus.DONE }
    },
    select: { id: true },
    orderBy: queueOrder
  });
  return tasks.map((task) => task.id);
}

async function writeQueueOrder(
  transaction: QueueTransaction,
  ids: string[]
) {
  await transaction.task.updateMany({
    where: { focusQueuePosition: { not: null } },
    data: { focusQueuePosition: null }
  });
  await Promise.all(
    ids.map((id, index) =>
      transaction.task.update({
        where: { id },
        data: { focusQueuePosition: index }
      })
    )
  );
}

export function parseQueuePlacement(value: unknown): QueuePlacement {
  if (value === "next" || value === "end") return value;
  throw new AppError(focusQueueErrors.queuePlacementMustBeNextOrEnd);
}

function sameOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const FocusQueueError = appErrorConstructor(
  (
    message: string
  ) => validation(message)
);
export type FocusQueueError = AppError;
/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as FocusQueueNotFoundError };

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as FocusQueueConflictError };
