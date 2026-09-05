import {
  requireObject as kernelRequireObject,
  readJsonBody,
  parseBoundedInteger as kernelParseBoundedInteger,
  has,
  parseEnum,
  parseRecordId,
  parseBoundedString,
  parseNullableLocalDate
} from "@/shared/kernel/parsing";
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
  const body = await readJsonBody(
    request,
    "body",
    "Request body must be valid JSON.",
    (message, field) =>
      new ProjectMutationRequestError(message, field, "INVALID_JSON")
  );
  return requireObject(body);
}

export function parseProjectPathId(
  value: unknown,
  field: "id" | "projectId" = "id",
  label = field === "projectId" ? "Project" : "Resource"
) {
  return parseRecordId(value, field, `${label} identifier is invalid.`, validationError, {
    maximumLength: PROJECT_ID_MAX_LENGTH,
    rejectControlCharacters: true
  });
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
  return kernelRequireObject(
    value, "body", "Request body must be a JSON object.", validationError
  );
}

function parseRequiredText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  return parseBoundedString(value, field, `${label} is required.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength} characters or fewer.`,
    emptyMessage: `${label} is required.`,
    trim: true
  });
}

function parseOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (value === null || value === undefined) return "";
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength} characters or fewer.`,
    trim: true
  });
}

function parseOptionalDate(value: unknown) {
  return parseNullableLocalDate(
    value,
    "targetDate",
    "Target date is invalid.",
    validationError,
    {
      nullValues: [null, undefined, ""],
      trim: true,
      parseDate: parseLocalDate
    }
  );
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
  return {
    value: parsedValue,
    unit: parseEnum(
      unit, projectDurationUnits, "targetDurationUnit",
      "Target duration unit must be DAYS or WEEKS.", validationError,
      { normalize: (text) => text.trim().toUpperCase() }
    )
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
  return kernelParseBoundedInteger(
    value, field, minimum, maximum, message, validationError
  );
}

function parseProjectStatus(value: unknown): ProjectStatusValue {
  return parseEnum(
    value,
    projectStatuses,
    "status",
    "Project status is invalid.",
    validationError,
    {
      normalize: (text) => text.trim().toUpperCase()
    }
  );
}

function validationError(message: string, field: string) {
  return new ProjectMutationRequestError(message, field);
}
