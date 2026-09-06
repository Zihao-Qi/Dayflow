import type { Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { assertQueueReorder, focusQueueErrors, planQueuePlacement, type QueuePlacement } from "../domain/focus-queue";

const queueOrder = [
  { focusQueuePosition: "asc" as const },
  { createdAt: "asc" as const }
];

export async function listFocusQueue(transaction: { task: Pick<Prisma.TransactionClient["task"], "findMany"> }) {
  return transaction.task.findMany({
    where: {
      focusQueuePosition: { not: null },
      status: { not: "DONE" }
    },
    orderBy: queueOrder
  });
}

export async function addToFocusQueue(
  transaction: Prisma.TransactionClient,
  taskId: string,
  placement: QueuePlacement
) {
  const task = await transaction.task.findUnique({
    where: { id: taskId },
    select: { id: true, status: true }
  });
  if (!task) throw new AppError(focusQueueErrors.taskNotFound);
  if (task.status === "DONE") {
    throw new AppError(focusQueueErrors.completedTasksCannotBeQueued);
  }

  const current = await queueIds(transaction);
  const ids = planQueuePlacement(current, taskId, placement);
  await writeQueueOrder(transaction, ids);
  return listFocusQueue(transaction);
}

export async function reorderFocusQueue(
  transaction: Prisma.TransactionClient,
  ids: string[],
  expectedIds: string[]
) {
  const current = await queueIds(transaction);
  assertQueueReorder(current, ids, expectedIds);
  await writeQueueOrder(transaction, ids);
  return listFocusQueue(transaction);
}

export async function removeFromFocusQueue(transaction: Prisma.TransactionClient, taskId: string) {
  const current = await queueIds(transaction);
  if (!current.includes(taskId)) return listFocusQueue(transaction);
  await writeQueueOrder(
    transaction,
    current.filter((id) => id !== taskId)
  );
  return listFocusQueue(transaction);
}

export async function consumeFocusQueueTask(
  transaction: Prisma.TransactionClient,
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

export async function compactFocusQueue(transaction: Prisma.TransactionClient) {
  await writeQueueOrder(transaction, await queueIds(transaction));
}

async function queueIds(transaction: Prisma.TransactionClient) {
  const tasks = await transaction.task.findMany({
    where: {
      focusQueuePosition: { not: null },
      status: { not: "DONE" }
    },
    select: { id: true },
    orderBy: queueOrder
  });
  return tasks.map((task) => task.id);
}

async function writeQueueOrder(
  transaction: Prisma.TransactionClient,
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

