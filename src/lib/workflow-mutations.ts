import { requestErrors } from "@/lib/request-errors";
import { workflowErrors } from "@/lib/workflow-errors";
import { AppError, validation } from "@/shared/kernel/errors";
import {
  parseBoundedInteger as kernelParseBoundedInteger,
  parseEnum as kernelParseEnum,
  requireObject as kernelRequireObject,
  parseBoundedString,
  parseRecordId,
  readJsonBody
} from "@/shared/kernel/parsing";

export const WORKFLOW_ID_MAX_LENGTH = 191;
export const WORKFLOW_ID_ARRAY_MAX_ITEMS = 1_000;
export const FOCUS_LABEL_MAX_LENGTH = 500;
export const FOCUS_COMPLETION_NOTE_MAX_LENGTH = 5_000;
export const FOCUS_CATEGORY_MAX_LENGTH = 100;

const focusKinds = ["FOCUS", "BREAK"] as const;
const focusActions = [
  "pause",
  "resume",
  "cancel",
  "complete",
  "enrich",
  "record"
] as const;

type JsonObject = Record<string, unknown>;
type FocusKind = (typeof focusKinds)[number];
export type FocusAction = (typeof focusActions)[number];
export type WorkflowMutationErrorCode = "INVALID_JSON" | "VALIDATION_ERROR";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as WorkflowMutationRequestError };

export async function readWorkflowMutationBody(request: {
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

export { parseFocusQueueAddMutation, parseFocusQueueReorderMutation, parseFocusQueueRemoveMutation,
  type QueuePlacementMutation } from "@/modules/planning/domain/focus-queue";
export { parseTaskReorderMutation } from "@/modules/planning/domain/task";

export function parseFocusSessionStartMutation(value: unknown): {
  kind: FocusKind;
  plannedMinutes: number;
  label?: string;
  taskId: string | null;
  projectId: string | null;
} {
  const body = requireObject(value);
  const kind =
    body.kind === undefined || body.kind === null || body.kind === ""
      ? "FOCUS"
      : parseEnum(
        typeof body.kind === "string"
          ? body.kind.trim().toUpperCase()
          : body.kind,
        focusKinds,
        "kind",
        workflowErrors.timerKindMustBeFOCUSOrBREAK.message
      );
  const label = parseOptionalText(
    body.label,
    "label",
    "Timer label",
    FOCUS_LABEL_MAX_LENGTH
  );

  return {
    kind,
    plannedMinutes: parseBoundedInteger(
      body.plannedMinutes,
      "plannedMinutes",
      1,
      240,
      workflowErrors.timerDurationMustBeBetween1And240Minutes.message
    ),
    label: label || undefined,
    taskId: parseOptionalWorkflowId(
      body.taskId,
      "taskId",
      workflowErrors.taskIdentifierIsInvalid.message
    ),
    projectId: parseOptionalWorkflowId(
      body.projectId,
      "projectId",
      "Project identifier is invalid."
    )
  };
}

export function parseFocusSessionTransitionMutation(value: unknown): {
  action: FocusAction;
  note?: string;
  category?: string;
  taskCompleted?: boolean;
} {
  const body = requireObject(value);
  const action = parseEnum(
    typeof body.action === "string"
      ? body.action.trim().toLowerCase()
      : body.action,
    focusActions,
    "action",
    workflowErrors.unknownTimerAction.message
  );

  return {
    action,
    note: parseOptionalText(
      body.note,
      "note",
      "Completion note",
      FOCUS_COMPLETION_NOTE_MAX_LENGTH
    ),
    category: parseOptionalText(
      body.category,
      "category",
      "Completion category",
      FOCUS_CATEGORY_MAX_LENGTH
    ),
    taskCompleted: parseOptionalBoolean(body.taskCompleted, "taskCompleted")
  };
}

export function parseWorkflowId(
  value: unknown,
  field: string,
  message = "Identifier is invalid."
) {
  return parseRecordId(value, field, message, validationError, {
    maximumLength: WORKFLOW_ID_MAX_LENGTH,
    rejectControlCharacters: true
  });
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseOptionalWorkflowId(
  value: unknown,
  field: string,
  message: string
) {
  return parseRecordId(value, field, message, validationError, {
    maximumLength: WORKFLOW_ID_MAX_LENGTH,
    rejectControlCharacters: true,
    nullValues: [undefined, null, ""]
  });
}

function parseOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (value === undefined || value === null) return undefined;
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`,
    trim: true
  });
}

function parseOptionalBoolean(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw validation("Task completion must be true or false.", field);
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
