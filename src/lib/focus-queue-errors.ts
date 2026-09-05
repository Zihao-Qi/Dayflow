import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the focus-queue boundary. Property order is wire order. */
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
