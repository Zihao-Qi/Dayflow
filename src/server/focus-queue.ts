import { runInTransaction } from "@/server/prisma/client";
import { appErrorResponse } from "@/lib/http-errors";
import { focusQueueErrors, type QueuePlacement } from "@/modules/planning/domain/focus-queue";
import * as queue from "@/modules/planning/services/focus-queue";
import { AppError } from "@/shared/kernel/errors";

export { listFocusQueue, addToFocusQueue, reorderFocusQueue, removeFromFocusQueue,
  consumeFocusQueueTask, compactFocusQueue } from "@/modules/planning/services/focus-queue";

// Preserve the old transaction-owning signatures for legacy callers.
export const addToFocusQueueWithTransaction = (taskId: string, placement: QueuePlacement) =>
  runInTransaction((tx) => queue.addToFocusQueue(tx, taskId, placement));
export const reorderFocusQueueWithTransaction = (ids: string[], expectedIds: string[]) =>
  runInTransaction((tx) => queue.reorderFocusQueue(tx, ids, expectedIds));
export const removeFromFocusQueueWithTransaction = (taskId: string) =>
  runInTransaction((tx) => queue.removeFromFocusQueue(tx, taskId));

export function focusQueueMutationErrorResponse(error: unknown, operation: "save" | "reorder" | "remove") {
  if (error instanceof AppError) return appErrorResponse(error);
  console.error(`Focus queue ${operation} failed.`, error);
  return appErrorResponse(new AppError(focusQueueErrors.focusQueueCouldNotBeSaved));
}
