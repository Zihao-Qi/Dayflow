import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the workflow boundary. The serializer emits exactly the declared properties. */
export const workflowErrors = {
  queuePlacementMustBeNextOrEnd: {
    status: 400,
    message: "Queue placement must be next or end.",
    code: "VALIDATION_ERROR",
    field: "placement"
  },
  timerDurationMustBeBetween1And240Minutes: {
    status: 400,
    message: "Timer duration must be between 1 and 240 minutes.",
    code: "VALIDATION_ERROR",
    field: "plannedMinutes"
  },
  unknownTimerAction: {
    status: 400,
    message: "Unknown timer action.",
    code: "VALIDATION_ERROR",
    field: "action"
  },
  taskIdentifierIsInvalid: {
    status: 400,
    message: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "taskId"
  },
  timerKindMustBeFOCUSOrBREAK: {
    status: 400,
    message: "Timer kind must be FOCUS or BREAK.",
    code: "VALIDATION_ERROR",
    field: "kind"
  },
  focusSessionIdentifierIsInvalid: {
    status: 400,
    message: "Focus session identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  }
} as const satisfies Record<string, ErrorSpec>;
