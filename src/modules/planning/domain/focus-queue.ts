import { appErrorConstructor } from "@/shared/kernel/error-compat";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import { parseEnum, parseRecordId, requireObject } from "@/shared/kernel/parsing";
import { requestErrors } from "@/shared/kernel/request-errors";
import { parseTaskIdArray, readTaskMutationBody, TASK_ID_MAX_LENGTH } from "./task";
export type QueuePlacement = "next" | "end";
export type QueuePlacementMutation = QueuePlacement;
export { readTaskMutationBody as readFocusQueueMutationBody };

export function parseQueuePlacement(value: unknown): QueuePlacement {
  if (value === "next" || value === "end") return value;
  throw new AppError(focusQueueErrors.queuePlacementMustBeNextOrEnd);
}

export function sameOrder(left: string[], right: string[]) {
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


/** Exact envelopes owned by the focus-queue boundary. Emits exactly the declared properties. */
export const focusQueueErrors = {
  taskNotFound: {
    status: 404,
    message: "Task not found.",
    code: "NOT_FOUND",
    field: "taskId"
  },
  completedTasksCannotBeQueued: {
    status: 409,
    message: "Completed tasks cannot be queued.",
    code: "CONFLICT"
  },
  queueOrderIsOutOfDateRefreshAndTryAgain: {
    status: 409,
    message: "Queue order is out of date. Refresh and try again.",
    code: "CONFLICT"
  },
  queuePlacementMustBeNextOrEnd: {
    status: 400,
    message: "Queue placement must be next or end.",
    code: "VALIDATION_ERROR"
  },
  focusQueueCouldNotBeSaved: {
    status: 500,
    message: "Focus queue could not be saved.",
    code: "INTERNAL_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;

export function planQueuePlacement(current: string[], taskId: string, placement: QueuePlacement) {
  const withoutTask = current.filter((id) => id !== taskId);
  return placement === "next" ? [taskId, ...withoutTask] : [...withoutTask, taskId];
}

export function assertQueueReorder(current: string[], ids: string[], expectedIds: string[]) {
  if (!sameOrder(current, expectedIds) || ids.length !== current.length ||
      new Set(ids).size !== ids.length || current.some((id) => !ids.includes(id))) {
    throw new AppError(focusQueueErrors.queueOrderIsOutOfDateRefreshAndTryAgain);
  }
}

function bodyObject(value: unknown) {
  return requireObject(value, "body", requestErrors.objectRequired.message, validation);
}
function parseQueueTaskId(value: unknown) {
  return parseRecordId(value, "taskId", "Task identifier is invalid.", validation, {
    maximumLength: TASK_ID_MAX_LENGTH, rejectControlCharacters: true
  });
}
export function parseFocusQueueAddMutation(value: unknown) {
  const body = bodyObject(value);
  return {
    taskId: parseQueueTaskId(body.taskId),
    placement: parseEnum(body.placement, ["next", "end"] as const, "placement",
      focusQueueErrors.queuePlacementMustBeNextOrEnd.message, validation)
  };
}
export function parseFocusQueueReorderMutation(value: unknown) {
  const body = bodyObject(value);
  return { ids: parseTaskIdArray(body.ids, "ids"), expectedIds: parseTaskIdArray(body.expectedIds, "expectedIds") };
}
export function parseFocusQueueRemoveMutation(value: unknown) {
  const body = bodyObject(value);
  return { taskId: parseQueueTaskId(body.taskId) };
}
