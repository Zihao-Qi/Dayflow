import { parseLocalDate, startOfLocalDay, type Calendar } from "@/shared/kernel/calendar";
import { requestErrors } from "@/shared/kernel/request-errors";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import {
  has,
  parseBoundedInteger as kernelParseBoundedInteger,
  parseEnum as kernelParseEnum,
  requireObject as kernelRequireObject,
  parseBoundedString,
  parseNullableLocalDate,
  parseRecordId,
  readJsonBody
} from "@/shared/kernel/parsing";

export const TASK_TITLE_MAX_LENGTH = 500;
export const TASK_ESTIMATE_MAX_MINUTES = 1_440;
export const TASK_ID_MAX_LENGTH = 191;
export const TASK_RELATION_ID_MAX_LENGTH = 200;
export const TASK_SCHEDULE_SOURCE_MAX_LENGTH = 100;

const PRISMA_INT_MAX = 2_147_483_647;
const taskStatuses = ["TODO", "IN_PROGRESS", "DONE"] as const;
const taskPriorities = ["LOW", "MEDIUM", "HIGH"] as const;

export type TaskStatusValue = (typeof taskStatuses)[number];
export type TaskPriorityValue = (typeof taskPriorities)[number];
export type TaskMutationErrorCode = "INVALID_JSON" | "VALIDATION_ERROR";

type JsonObject = Record<string, unknown>;

export type TaskCreateMutation = {
  title: string;
  date: Date | null;
  priority: TaskPriorityValue;
  status: TaskStatusValue;
  urgentScore: number;
  importanceScore: number;
  deadline: Date | null;
  estimateMinutes: number;
  projectId: string | null;
  phaseId: string | null;
  completedAt: Date | null;
};

export type TaskPatchData = {
  title?: string;
  date?: Date | null;
  priority?: TaskPriorityValue;
  status?: TaskStatusValue;
  urgentScore?: number;
  importanceScore?: number;
  deadline?: Date | null;
  estimateMinutes?: number;
  actualMinutes?: number;
  sortOrder?: number;
  projectId?: string | null;
  phaseId?: string | null;
  completedAt?: Date | null;
};

export type CurrentTaskPlacement = {
  projectId: string | null;
  phaseId: string | null;
  status: TaskStatusValue;
};

export type TaskPatchMutation = {
  data: TaskPatchData;
  projectId: string | null;
  phaseId: string | null;
  status: TaskStatusValue;
  requestedStatus: TaskStatusValue | null;
  scheduleSource: string;
};

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as TaskMutationValidationError };

export async function readTaskMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  const body = await readJsonBody(
    request,
    "body",
    requestErrors.invalidJson.message,
    () => new AppError(requestErrors.invalidJson)
  );
  return requireObject(body);
}

export function parseTaskPathId(value: unknown) {
  return parseRecordId(value, "id", taskErrors.taskIdentifierIsInvalid.message, validationError, {
    maximumLength: TASK_ID_MAX_LENGTH,
    rejectControlCharacters: true
  });
}

export function parseTaskCreateMutation(
  value: unknown,
  now: Date
): TaskCreateMutation {
  const body = requireObject(value);
  const status = has(body, "status")
    ? parseEnum(body.status, taskStatuses, "status", taskErrors.taskStatusIsInvalid.message)
    : "TODO";

  return {
    title: parseTitle(body.title),
    date: has(body, "date")
      ? parseNullableDate(body.date, "date", taskErrors.scheduledDateIsInvalid.message)
      : startOfLocalDay(now),
    priority: has(body, "priority")
      ? parseEnum(
        body.priority,
        taskPriorities,
        "priority",
        taskErrors.taskPriorityIsInvalid.message
      )
      : "MEDIUM",
    status,
    urgentScore: has(body, "urgentScore")
      ? parseBoundedInteger(
        body.urgentScore,
        "urgentScore",
        1,
        5,
        taskErrors.urgencyScoreMustBeAWholeNumberFrom1To5.message
      )
      : 2,
    importanceScore: has(body, "importanceScore")
      ? parseBoundedInteger(
        body.importanceScore,
        "importanceScore",
        1,
        5,
        taskErrors.importanceScoreMustBeAWholeNumberFrom1To5.message
      )
      : 3,
    deadline: has(body, "deadline")
      ? parseNullableDate(body.deadline, "deadline", taskErrors.deadlineIsInvalid.message)
      : null,
    estimateMinutes: has(body, "estimateMinutes")
      ? parseBoundedInteger(
        body.estimateMinutes,
        "estimateMinutes",
        0,
        TASK_ESTIMATE_MAX_MINUTES,
        taskErrors.estimateMustBeAWholeNumberFrom0To1440Minutes.message
      )
      : 30,
    projectId: has(body, "projectId")
      ? parseRelationId(body.projectId, "projectId")
      : null,
    phaseId: has(body, "phaseId")
      ? parseRelationId(body.phaseId, "phaseId")
      : null,
    completedAt: status === "DONE" ? now : null
  };
}

export function parseTaskPatchInput(
  value: unknown,
  now: Date
): TaskPatchInput {
  const body = requireObject(value);
  const data: TaskPatchData = {};

  if (has(body, "title")) data.title = parseTitle(body.title);
  if (has(body, "priority")) {
    data.priority = parseEnum(
      body.priority,
      taskPriorities,
      "priority",
      taskErrors.taskPriorityIsInvalid.message
    );
  }

  let requestedStatus: TaskStatusValue | null = null;
  if (has(body, "status")) {
    requestedStatus = parseEnum(
      body.status,
      taskStatuses,
      "status",
      taskErrors.taskStatusIsInvalid.message
    );
    data.status = requestedStatus;
    data.completedAt = requestedStatus === "DONE" ? now : null;
  }

  if (has(body, "estimateMinutes")) {
    data.estimateMinutes = parseBoundedInteger(
      body.estimateMinutes,
      "estimateMinutes",
      0,
      TASK_ESTIMATE_MAX_MINUTES,
      taskErrors.estimateMustBeAWholeNumberFrom0To1440Minutes.message
    );
  }
  if (has(body, "actualMinutes")) {
    data.actualMinutes = parseBoundedInteger(
      body.actualMinutes,
      "actualMinutes",
      0,
      PRISMA_INT_MAX,
      taskErrors.actualMinutesMustBeANonnegativeWholeNumber.message
    );
  }
  if (has(body, "sortOrder")) {
    data.sortOrder = parseBoundedInteger(
      body.sortOrder,
      "sortOrder",
      0,
      PRISMA_INT_MAX,
      taskErrors.taskOrderMustBeANonnegativeWholeNumber.message
    );
  }
  if (has(body, "urgentScore")) {
    data.urgentScore = parseBoundedInteger(
      body.urgentScore,
      "urgentScore",
      1,
      5,
      taskErrors.urgencyScoreMustBeAWholeNumberFrom1To5.message
    );
  }
  if (has(body, "importanceScore")) {
    data.importanceScore = parseBoundedInteger(
      body.importanceScore,
      "importanceScore",
      1,
      5,
      taskErrors.importanceScoreMustBeAWholeNumberFrom1To5.message
    );
  }
  if (has(body, "date")) {
    data.date = parseNullableDate(
      body.date,
      "date",
      taskErrors.scheduledDateIsInvalid.message
    );
  }
  if (has(body, "deadline")) {
    data.deadline = parseNullableDate(
      body.deadline,
      "deadline",
      taskErrors.deadlineIsInvalid.message
    );
  }

  if (has(body, "projectId")) data.projectId = parseRelationId(body.projectId, "projectId");
  if (has(body, "phaseId")) data.phaseId = parseRelationId(body.phaseId, "phaseId");
  return {
    data,
    requestedStatus,
    scheduleSource: has(body, "date") ? parseScheduleSource(body.scheduleSource) : "manual"
  };
}

export type TaskPatchInput = Pick<TaskPatchMutation, "data" | "requestedStatus" | "scheduleSource">;

function resolveTaskPatch(input: TaskPatchInput, current: CurrentTaskPlacement, now: Date): TaskPatchMutation {
  const data = { ...input.data };
  const projectId = has(data, "projectId") ? data.projectId ?? null : current.projectId;
  const phaseId = has(data, "phaseId") ? data.phaseId ?? null
    : projectId === current.projectId ? current.phaseId : null;
  if (has(data, "phaseId") || phaseId !== current.phaseId) data.phaseId = phaseId;
  if (input.requestedStatus !== null) data.completedAt = input.requestedStatus === "DONE" ? now : null;
  return { ...input, data, projectId, phaseId, status: input.requestedStatus ?? current.status };
}

/** Compatibility parser for callers that already have the current placement. */
export function parseTaskPatchMutation(value: unknown, current: CurrentTaskPlacement, now: Date): TaskPatchMutation {
  return resolveTaskPatch(parseTaskPatchInput(value, now), current, now);
}

/** The persisted date comparison intentionally retains the legacy instant semantics. */
export function planTaskPatch(
  current: CurrentTaskPlacement & { date: Date | null },
  patch: TaskPatchInput,
  _calendar: Calendar,
  now: Date
) {
  const input = resolveTaskPatch(patch, current, now);
  const nextDate = has(input.data, "date") ? input.data.date ?? null : current.date;
  const dateChanged = current.date?.getTime() !== nextDate?.getTime();
  return {
    ...input,
    consumeQueue: input.requestedStatus === "DONE",
    scheduleChange: dateChanged ? {
      previousDate: current.date, nextDate, source: input.scheduleSource
    } : null
  };
}

export function validateTaskPatchMutation(
  value: unknown,
  now: Date
) {
  parseTaskPatchMutation(
    value,
    { projectId: null, phaseId: null, status: "TODO" },
    now
  );
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseTitle(value: unknown) {
  return parseBoundedString(value, "title", taskErrors.taskTitleIsRequired.message, validationError, {
    maximumLength: TASK_TITLE_MAX_LENGTH,
    lengthMessage: `Task title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.`,
    emptyMessage: taskErrors.taskTitleIsRequired.message,
    trim: true
  });
}

function parseNullableDate(
  value: unknown,
  field: "date" | "deadline",
  message: string
) {
  return parseNullableLocalDate(value, field, message, validationError, {
    nullValues: [null, ""],
    trim: true,
    parseDate: parseLocalDate
  });
}

function parseRelationId(value: unknown, field: "projectId" | "phaseId") {
  return parseRecordId(
    value,
    field,
    `${field === "projectId" ? "Project" : "Phase"} identifier is invalid.`,
    validationError,
    {
      maximumLength: TASK_RELATION_ID_MAX_LENGTH,
      rejectControlCharacters: false,
      nullValues: [null, ""],
      blankAsNull: true
    }
  );
}

function parseScheduleSource(value: unknown) {
  if (value === null || value === undefined) return "manual";
  return parseBoundedString(
    value,
    "scheduleSource",
    taskErrors.scheduleSourceIsInvalid.message,
    validationError,
    {
      maximumLength: TASK_SCHEDULE_SOURCE_MAX_LENGTH,
      lengthMessage: taskErrors.scheduleSourceIsInvalid.message,
      trim: false
    }
  );
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  message: string
) {
  return kernelParseBoundedInteger(
    value, field, minimum, maximum, message, validationError
  );
}

function parseEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  message: string
): Values[number] {
  return kernelParseEnum(value, values, field, message, validationError);
}

function validationError(message: string, field: string) {
  return validation(message, field);
}


/** Exact envelopes owned by the task boundary. Emits exactly the declared properties. */
export const taskErrors = {
  theScheduleChangedBeforeItCouldBeUndone: {
    status: 409,
    message: "The schedule changed before it could be undone.",
    code: "CONFLICT"
  },
  taskNotFound: {
    status: 404,
    message: "Task not found.",
    code: "NOT_FOUND"
  },
  aRelatedRecordChangedBeforeTheTaskCouldBeSaved: {
    status: 409,
    message: "A related record changed before the task could be saved.",
    code: "CONFLICT"
  },
  taskCouldNotBeDeleted: {
    status: 500,
    message: "Task could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  taskCouldNotBeSaved: {
    status: 500,
    message: "Task could not be saved.",
    code: "INTERNAL_ERROR"
  },
  taskNotFoundidNOTFOUND: {
    status: 404,
    message: "Task not found.",
    code: "NOT_FOUND",
    field: "id"
  },
  thereIsNoScheduleChangeToUndo: {
    status: 404,
    message: "There is no schedule change to undo.",
    code: "NOT_FOUND",
    field: "scheduleChange"
  },
  theScheduleChangeCouldNotBeUndone: {
    status: 500,
    message: "The schedule change could not be undone.",
    code: "INTERNAL_ERROR"
  },
  oneOrMoreTasksCouldNotBeFound: {
    status: 404,
    message: "One or more tasks could not be found.",
    code: "NOT_FOUND",
    field: "ids"
  },
  aTaskChangedBeforeItsOrderCouldBeSaved: {
    status: 409,
    message: "A task changed before its order could be saved.",
    code: "CONFLICT"
  },
  taskOrderCouldNotBeSaved: {
    status: 500,
    message: "Task order could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theSelectedTaskRelationshipIsNoLongerAvailable: {
    status: 409,
    message: "The selected task relationship is no longer available.",
    code: "CONFLICT"
  },
  taskCouldNotBeCreated: {
    status: 500,
    message: "Task could not be created.",
    code: "INTERNAL_ERROR"
  },
  estimateMustBeAWholeNumberFrom0To1440Minutes: {
    status: 400,
    message: "Estimate must be a whole number from 0 to 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "estimateMinutes"
  },
  taskStatusIsInvalid: {
    status: 400,
    message: "Task status is invalid.",
    code: "VALIDATION_ERROR",
    field: "status"
  },
  taskIdentifierIsInvalid: {
    status: 400,
    message: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  taskIdentifiersMustNotContainDuplicates: {
    status: 400,
    message: "Task identifiers must not contain duplicates.",
    code: "VALIDATION_ERROR",
    field: "ids"
  },
  scheduledDateIsInvalid: {
    status: 400,
    message: "Scheduled date is invalid.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  taskPriorityIsInvalid: {
    status: 400,
    message: "Task priority is invalid.",
    code: "VALIDATION_ERROR",
    field: "priority"
  },
  urgencyScoreMustBeAWholeNumberFrom1To5: {
    status: 400,
    message: "Urgency score must be a whole number from 1 to 5.",
    code: "VALIDATION_ERROR",
    field: "urgentScore"
  },
  importanceScoreMustBeAWholeNumberFrom1To5: {
    status: 400,
    message: "Importance score must be a whole number from 1 to 5.",
    code: "VALIDATION_ERROR",
    field: "importanceScore"
  },
  deadlineIsInvalid: {
    status: 400,
    message: "Deadline is invalid.",
    code: "VALIDATION_ERROR",
    field: "deadline"
  },
  actualMinutesMustBeANonnegativeWholeNumber: {
    status: 400,
    message: "Actual minutes must be a non-negative whole number.",
    code: "VALIDATION_ERROR",
    field: "actualMinutes"
  },
  taskOrderMustBeANonnegativeWholeNumber: {
    status: 400,
    message: "Task order must be a non-negative whole number.",
    code: "VALIDATION_ERROR",
    field: "sortOrder"
  },
  taskTitleIsRequired: {
    status: 400,
    message: "Task title is required.",
    code: "VALIDATION_ERROR",
    field: "title"
  },
  scheduleSourceIsInvalid: {
    status: 400,
    message: "Schedule source is invalid.",
    code: "VALIDATION_ERROR",
    field: "scheduleSource"
  }
} as const satisfies Record<string, ErrorSpec>;

export const TASK_REORDER_MAX_ITEMS = 1_000;
export function parseTaskReorderMutation(value: unknown) {
  const body = requireObject(value);
  return { ids: parseTaskIdArray(body.ids, "ids") };
}

export function parseTaskIdArray(value: unknown, field: "ids" | "expectedIds") {
  if (!Array.isArray(value)) {
    throw validation(`${field === "ids" ? "Task identifiers" : "Expected task identifiers"} must be an array.`, field);
  }
  if (value.length > TASK_REORDER_MAX_ITEMS) {
    throw validation(`No more than ${TASK_REORDER_MAX_ITEMS.toLocaleString("en-US")} task identifiers can be reordered at once.`, field);
  }
  const ids = value.map((id) =>
    parseRecordId(id, field, taskErrors.taskIdentifierIsInvalid.message, validationError, { maximumLength: TASK_ID_MAX_LENGTH, rejectControlCharacters: true })
  );
  if (new Set(ids).size !== ids.length) {
    throw validation("Task identifiers must not contain duplicates.", field);
  }
  return ids;
}


export type TaskRecord = {
  id: string;
  title: string;
  date: string | null;
  status: TaskStatusValue;
  priority: TaskPriorityValue;
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  focusQueuePosition: number | null;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

export function isTaskRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<TaskRecord>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.focusQueuePosition === null ||
      Number.isInteger(task.focusQueuePosition)) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

export type PersistedTask = Omit<TaskRecord, "date" | "deadline" | "completedAt"> & {
  date: Date | null;
  deadline: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Emits exactly the persisted Task properties, with dates in the existing ISO format. */
export function serializeTask(task: PersistedTask): TaskRecord & { createdAt: string; updatedAt: string } {
  return {
    id: task.id, title: task.title, date: task.date?.toISOString() ?? null,
    status: task.status, priority: task.priority, urgentScore: task.urgentScore,
    importanceScore: task.importanceScore, deadline: task.deadline?.toISOString() ?? null,
    estimateMinutes: task.estimateMinutes, actualMinutes: task.actualMinutes,
    sortOrder: task.sortOrder, focusQueuePosition: task.focusQueuePosition,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    projectId: task.projectId, phaseId: task.phaseId
  };
}
