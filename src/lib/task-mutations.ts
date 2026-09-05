import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import { requestErrors } from "@/lib/request-errors";
import { taskErrors } from "@/lib/task-errors";
import { AppError, validation } from "@/shared/kernel/errors";
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
  now = new Date()
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

export function parseTaskPatchMutation(
  value: unknown,
  current: CurrentTaskPlacement,
  now = new Date()
): TaskPatchMutation {
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

  const projectId = has(body, "projectId")
    ? parseRelationId(body.projectId, "projectId")
    : current.projectId;
  const phaseId = has(body, "phaseId")
    ? parseRelationId(body.phaseId, "phaseId")
    : projectId === current.projectId
      ? current.phaseId
      : null;
  const status = requestedStatus ?? current.status;

  if (has(body, "projectId") || projectId !== current.projectId) {
    data.projectId = projectId;
  }
  if (has(body, "phaseId") || phaseId !== current.phaseId) {
    data.phaseId = phaseId;
  }

  return {
    data,
    projectId,
    phaseId,
    status,
    requestedStatus,
    scheduleSource: has(body, "date")
      ? parseScheduleSource(body.scheduleSource)
      : "manual"
  };
}

export function validateTaskPatchMutation(
  value: unknown,
  now = new Date()
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
