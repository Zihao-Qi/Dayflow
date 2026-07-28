import { parseLocalDate } from "@/lib/dates";

export const PROJECT_NAME_MAX_LENGTH = 500;
export const PROJECT_OUTCOME_MAX_LENGTH = 5_000;
export const PROJECT_ID_MAX_LENGTH = 191;
export const PROJECT_TARGET_DURATION_MAX = 10_000;
export const PROJECT_WEEKLY_BUDGET_MAX_MINUTES = 10_080;
export const PHASE_NAME_MAX_LENGTH = 500;
export const PHASE_SORT_ORDER_MAX = 2_147_483_647;

const projectStatuses = [
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED"
] as const;
const projectDurationUnits = ["DAYS", "WEEKS"] as const;

export type ProjectStatusValue = (typeof projectStatuses)[number];
export type ProjectDurationUnitValue = (typeof projectDurationUnits)[number];
export type ProjectMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "RELATIONSHIP_CONFLICT";

type JsonObject = Record<string, unknown>;

export type ProjectCreateMutation = {
  name: string;
  desiredOutcome: string;
  targetDate: Date | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnitValue | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatusValue;
};

export type ProjectPatchMutation = {
  data: {
    name?: string;
    desiredOutcome?: string;
    targetDate?: Date | null;
    targetDurationValue?: number | null;
    targetDurationUnit?: ProjectDurationUnitValue | null;
    weeklyMinutesBudget?: number | null;
    status?: ProjectStatusValue;
  };
  confirmCompletion: boolean;
};

export type PhaseCreateMutation = {
  name: string;
};

export type PhasePatchMutation = {
  name?: string;
  sortOrder?: number;
};

export class ProjectMutationRequestError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code: ProjectMutationErrorCode = "VALIDATION_ERROR",
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "ProjectMutationRequestError";
  }
}

export async function readProjectMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ProjectMutationRequestError(
      "Request body must be valid JSON.",
      "body",
      "INVALID_JSON"
    );
  }
  return requireObject(body);
}

export function parseProjectPathId(
  value: unknown,
  field: "id" | "projectId" = "id",
  label = field === "projectId" ? "Project" : "Resource"
) {
  if (typeof value !== "string") {
    throw new ProjectMutationRequestError(
      `${label} identifier is invalid.`,
      field
    );
  }
  const id = value.trim();
  if (
    !id ||
    id.length > PROJECT_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new ProjectMutationRequestError(
      `${label} identifier is invalid.`,
      field
    );
  }
  return id;
}

export function parseProjectCreateMutation(
  value: unknown
): ProjectCreateMutation {
  const body = requireObject(value);
  const duration = parseTargetDuration(
    body.targetDurationValue,
    body.targetDurationUnit
  );

  return {
    name: parseRequiredText(
      body.name,
      "name",
      "Project name",
      PROJECT_NAME_MAX_LENGTH
    ),
    desiredOutcome: parseOptionalText(
      body.desiredOutcome,
      "desiredOutcome",
      "Desired outcome",
      PROJECT_OUTCOME_MAX_LENGTH
    ),
    targetDate: parseOptionalDate(body.targetDate),
    targetDurationValue: duration?.value ?? null,
    targetDurationUnit: duration?.unit ?? null,
    weeklyMinutesBudget: parseOptionalPositiveInteger(
      body.weeklyMinutesBudget,
      "weeklyMinutesBudget",
      PROJECT_WEEKLY_BUDGET_MAX_MINUTES,
      `Weekly effort budget must be a whole number from 1 to ${PROJECT_WEEKLY_BUDGET_MAX_MINUTES} minutes.`
    ),
    status: has(body, "status") ? parseProjectStatus(body.status) : "ACTIVE"
  };
}

export function parseProjectPatchMutation(
  value: unknown
): ProjectPatchMutation {
  const body = requireObject(value);
  const data: ProjectPatchMutation["data"] = {};

  if (has(body, "name")) {
    data.name = parseRequiredText(
      body.name,
      "name",
      "Project name",
      PROJECT_NAME_MAX_LENGTH
    );
  }
  if (has(body, "desiredOutcome")) {
    data.desiredOutcome = parseOptionalText(
      body.desiredOutcome,
      "desiredOutcome",
      "Desired outcome",
      PROJECT_OUTCOME_MAX_LENGTH
    );
  }
  if (has(body, "targetDate")) {
    data.targetDate = parseOptionalDate(body.targetDate);
  }
  if (has(body, "weeklyMinutesBudget")) {
    data.weeklyMinutesBudget = parseOptionalPositiveInteger(
      body.weeklyMinutesBudget,
      "weeklyMinutesBudget",
      PROJECT_WEEKLY_BUDGET_MAX_MINUTES,
      `Weekly effort budget must be a whole number from 1 to ${PROJECT_WEEKLY_BUDGET_MAX_MINUTES} minutes.`
    );
  }
  if (has(body, "targetDurationValue") || has(body, "targetDurationUnit")) {
    const duration = parseTargetDuration(
      body.targetDurationValue,
      body.targetDurationUnit
    );
    data.targetDurationValue = duration?.value ?? null;
    data.targetDurationUnit = duration?.unit ?? null;
  }
  if (has(body, "status")) {
    data.status = parseProjectStatus(body.status);
  }

  let confirmCompletion = false;
  if (has(body, "confirm")) {
    if (typeof body.confirm !== "boolean") {
      throw new ProjectMutationRequestError(
        "Completion confirmation must be true or false.",
        "confirm"
      );
    }
    confirmCompletion = body.confirm;
  }

  return { data, confirmCompletion };
}

export function parsePhaseCreateMutation(value: unknown): PhaseCreateMutation {
  const body = requireObject(value);
  return {
    name: parseRequiredText(
      body.name,
      "name",
      "Phase name",
      PHASE_NAME_MAX_LENGTH
    )
  };
}

export function parsePhasePatchMutation(value: unknown): PhasePatchMutation {
  const body = requireObject(value);
  const data: PhasePatchMutation = {};

  if (has(body, "name")) {
    data.name = parseRequiredText(
      body.name,
      "name",
      "Phase name",
      PHASE_NAME_MAX_LENGTH
    );
  }
  if (has(body, "sortOrder")) {
    data.sortOrder = parseBoundedInteger(
      body.sortOrder,
      "sortOrder",
      0,
      PHASE_SORT_ORDER_MAX,
      `Phase order must be a whole number from 0 to ${PHASE_SORT_ORDER_MAX}.`
    );
  }

  return data;
}

function requireObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectMutationRequestError(
      "Request body must be a JSON object.",
      "body"
    );
  }
  return value as JsonObject;
}

function parseRequiredText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (typeof value !== "string") {
    throw new ProjectMutationRequestError(`${label} is required.`, field);
  }
  const text = value.trim();
  if (!text) {
    throw new ProjectMutationRequestError(`${label} is required.`, field);
  }
  if (text.length > maximumLength) {
    throw new ProjectMutationRequestError(
      `${label} must be ${maximumLength} characters or fewer.`,
      field
    );
  }
  return text;
}

function parseOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new ProjectMutationRequestError(`${label} must be text.`, field);
  }
  const text = value.trim();
  if (text.length > maximumLength) {
    throw new ProjectMutationRequestError(
      `${label} must be ${maximumLength} characters or fewer.`,
      field
    );
  }
  return text;
}

function parseOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ProjectMutationRequestError(
      "Target date is invalid.",
      "targetDate"
    );
  }
  const date = parseLocalDate(value.trim());
  if (!date) {
    throw new ProjectMutationRequestError(
      "Target date is invalid.",
      "targetDate"
    );
  }
  return date;
}

function parseTargetDuration(value: unknown, unit: unknown) {
  const emptyValue = value === null || value === undefined || value === "";
  const emptyUnit = unit === null || unit === undefined || unit === "";
  if (emptyValue && emptyUnit) return null;

  const parsedValue = parseBoundedInteger(
    value,
    "targetDurationValue",
    1,
    PROJECT_TARGET_DURATION_MAX,
    `Target duration must be a whole number from 1 to ${PROJECT_TARGET_DURATION_MAX}.`
  );
  if (typeof unit !== "string") {
    throw new ProjectMutationRequestError(
      "Target duration unit must be DAYS or WEEKS.",
      "targetDurationUnit"
    );
  }
  const normalizedUnit = unit.trim().toUpperCase();
  if (!projectDurationUnits.includes(normalizedUnit as ProjectDurationUnitValue)) {
    throw new ProjectMutationRequestError(
      "Target duration unit must be DAYS or WEEKS.",
      "targetDurationUnit"
    );
  }
  return {
    value: parsedValue,
    unit: normalizedUnit as ProjectDurationUnitValue
  };
}

function parseOptionalPositiveInteger(
  value: unknown,
  field: string,
  maximum: number,
  message: string
) {
  if (value === null || value === undefined || value === "") return null;
  return parseBoundedInteger(value, field, 1, maximum, message);
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
    throw new ProjectMutationRequestError(message, field);
  }
  return value;
}

function parseProjectStatus(value: unknown): ProjectStatusValue {
  if (typeof value !== "string") {
    throw new ProjectMutationRequestError(
      "Project status is invalid.",
      "status"
    );
  }
  const status = value.trim().toUpperCase();
  if (!projectStatuses.includes(status as ProjectStatusValue)) {
    throw new ProjectMutationRequestError(
      "Project status is invalid.",
      "status"
    );
  }
  return status as ProjectStatusValue;
}

function has(object: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
