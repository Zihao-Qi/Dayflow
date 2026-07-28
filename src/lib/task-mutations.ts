import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

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

export type TaskProjectRuleErrorDetails = {
  code:
    | "RELATIONSHIP_NOT_FOUND"
    | "RELATIONSHIP_CONFLICT"
    | "VALIDATION_ERROR";
  field: "projectId" | "phaseId";
  status: 400 | 404 | 409;
};

export class TaskMutationValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code: TaskMutationErrorCode = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "TaskMutationValidationError";
  }
}

export async function readTaskMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new TaskMutationValidationError(
      "Request body must be valid JSON.",
      "body",
      "INVALID_JSON"
    );
  }
  return requireObject(body);
}

export function parseTaskPathId(value: unknown) {
  if (typeof value !== "string") {
    throw new TaskMutationValidationError(
      "Task identifier is invalid.",
      "id"
    );
  }
  const id = value.trim();
  if (
    !id ||
    id.length > TASK_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new TaskMutationValidationError(
      "Task identifier is invalid.",
      "id"
    );
  }
  return id;
}

export function parseTaskCreateMutation(
  value: unknown,
  now = new Date()
): TaskCreateMutation {
  const body = requireObject(value);
  const status = has(body, "status")
    ? parseEnum(body.status, taskStatuses, "status", "Task status is invalid.")
    : "TODO";

  return {
    title: parseTitle(body.title),
    date: has(body, "date")
      ? parseNullableDate(body.date, "date", "Scheduled date is invalid.")
      : startOfLocalDay(now),
    priority: has(body, "priority")
      ? parseEnum(
          body.priority,
          taskPriorities,
          "priority",
          "Task priority is invalid."
        )
      : "MEDIUM",
    status,
    urgentScore: has(body, "urgentScore")
      ? parseBoundedInteger(
          body.urgentScore,
          "urgentScore",
          1,
          5,
          "Urgency score must be a whole number from 1 to 5."
        )
      : 2,
    importanceScore: has(body, "importanceScore")
      ? parseBoundedInteger(
          body.importanceScore,
          "importanceScore",
          1,
          5,
          "Importance score must be a whole number from 1 to 5."
        )
      : 3,
    deadline: has(body, "deadline")
      ? parseNullableDate(body.deadline, "deadline", "Deadline is invalid.")
      : null,
    estimateMinutes: has(body, "estimateMinutes")
      ? parseBoundedInteger(
          body.estimateMinutes,
          "estimateMinutes",
          0,
          TASK_ESTIMATE_MAX_MINUTES,
          `Estimate must be a whole number from 0 to ${TASK_ESTIMATE_MAX_MINUTES} minutes.`
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
      "Task priority is invalid."
    );
  }

  let requestedStatus: TaskStatusValue | null = null;
  if (has(body, "status")) {
    requestedStatus = parseEnum(
      body.status,
      taskStatuses,
      "status",
      "Task status is invalid."
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
      `Estimate must be a whole number from 0 to ${TASK_ESTIMATE_MAX_MINUTES} minutes.`
    );
  }
  if (has(body, "actualMinutes")) {
    data.actualMinutes = parseBoundedInteger(
      body.actualMinutes,
      "actualMinutes",
      0,
      PRISMA_INT_MAX,
      "Actual minutes must be a non-negative whole number."
    );
  }
  if (has(body, "sortOrder")) {
    data.sortOrder = parseBoundedInteger(
      body.sortOrder,
      "sortOrder",
      0,
      PRISMA_INT_MAX,
      "Task order must be a non-negative whole number."
    );
  }
  if (has(body, "urgentScore")) {
    data.urgentScore = parseBoundedInteger(
      body.urgentScore,
      "urgentScore",
      1,
      5,
      "Urgency score must be a whole number from 1 to 5."
    );
  }
  if (has(body, "importanceScore")) {
    data.importanceScore = parseBoundedInteger(
      body.importanceScore,
      "importanceScore",
      1,
      5,
      "Importance score must be a whole number from 1 to 5."
    );
  }
  if (has(body, "date")) {
    data.date = parseNullableDate(
      body.date,
      "date",
      "Scheduled date is invalid."
    );
  }
  if (has(body, "deadline")) {
    data.deadline = parseNullableDate(
      body.deadline,
      "deadline",
      "Deadline is invalid."
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

export function taskProjectRuleErrorDetails(
  errorMessage: string
): TaskProjectRuleErrorDetails {
  const message = errorMessage.toLowerCase();
  const field = message.includes("phase") ? "phaseId" : "projectId";
  if (message.includes("could not be found")) {
    return { code: "RELATIONSHIP_NOT_FOUND", field, status: 404 };
  }
  if (
    message.includes("does not belong") ||
    message.includes("reopen the completed project")
  ) {
    return { code: "RELATIONSHIP_CONFLICT", field, status: 409 };
  }
  return { code: "VALIDATION_ERROR", field, status: 400 };
}

function requireObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskMutationValidationError(
      "Request body must be a JSON object.",
      "body"
    );
  }
  return value as JsonObject;
}

function parseTitle(value: unknown) {
  if (typeof value !== "string") {
    throw new TaskMutationValidationError("Task title is required.", "title");
  }
  const title = value.trim();
  if (!title) {
    throw new TaskMutationValidationError("Task title is required.", "title");
  }
  if (title.length > TASK_TITLE_MAX_LENGTH) {
    throw new TaskMutationValidationError(
      `Task title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.`,
      "title"
    );
  }
  return title;
}

function parseNullableDate(
  value: unknown,
  field: "date" | "deadline",
  message: string
) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TaskMutationValidationError(message, field);
  }
  const date = parseLocalDate(value.trim());
  if (!date) throw new TaskMutationValidationError(message, field);
  return date;
}

function parseRelationId(value: unknown, field: "projectId" | "phaseId") {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TaskMutationValidationError(
      `${field === "projectId" ? "Project" : "Phase"} identifier is invalid.`,
      field
    );
  }
  const id = value.trim();
  if (!id) return null;
  if (id.length > TASK_RELATION_ID_MAX_LENGTH) {
    throw new TaskMutationValidationError(
      `${field === "projectId" ? "Project" : "Phase"} identifier is invalid.`,
      field
    );
  }
  return id;
}

function parseScheduleSource(value: unknown) {
  if (value === null || value === undefined) return "manual";
  if (
    typeof value !== "string" ||
    value.length > TASK_SCHEDULE_SOURCE_MAX_LENGTH
  ) {
    throw new TaskMutationValidationError(
      "Schedule source is invalid.",
      "scheduleSource"
    );
  }
  return value;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  message: string
) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TaskMutationValidationError(message, field);
  }
  return value;
}

function parseEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  message: string
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TaskMutationValidationError(message, field);
  }
  return value as Values[number];
}

function has(object: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
