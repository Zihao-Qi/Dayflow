import {
  requireObject as kernelRequireObject,
  readJsonBody,
  parseBoundedInteger as kernelParseBoundedInteger,
  parseEnum as kernelParseEnum,
  parseRecordId,
  parseBoundedString
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
const queuePlacements = ["next", "end"] as const;

type JsonObject = Record<string, unknown>;
type FocusKind = (typeof focusKinds)[number];
export type FocusAction = (typeof focusActions)[number];
export type QueuePlacementMutation = (typeof queuePlacements)[number];
export type WorkflowMutationErrorCode = "INVALID_JSON" | "VALIDATION_ERROR";

export class WorkflowMutationRequestError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code: WorkflowMutationErrorCode = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "WorkflowMutationRequestError";
  }
}

export async function readWorkflowMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  const body = await readJsonBody(
    request,
    "body",
    "Request body must be valid JSON.",
    (message, field) =>
      new WorkflowMutationRequestError(message, field, "INVALID_JSON")
  );
  return requireObject(body);
}

export function parseFocusQueueAddMutation(value: unknown) {
  const body = requireObject(value);
  return {
    taskId: parseWorkflowId(
      body.taskId,
      "taskId",
      "Task identifier is invalid."
    ),
    placement: parseEnum(
      body.placement,
      queuePlacements,
      "placement",
      "Queue placement must be next or end."
    )
  };
}

export function parseFocusQueueReorderMutation(value: unknown) {
  const body = requireObject(value);
  return {
    ids: parseIdArray(body.ids, "ids"),
    expectedIds: parseIdArray(body.expectedIds, "expectedIds")
  };
}

export function parseFocusQueueRemoveMutation(value: unknown) {
  const body = requireObject(value);
  return {
    taskId: parseWorkflowId(
      body.taskId,
      "taskId",
      "Task identifier is invalid."
    )
  };
}

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
          "Timer kind must be FOCUS or BREAK."
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
      "Timer duration must be between 1 and 240 minutes."
    ),
    label: label || undefined,
    taskId: parseOptionalWorkflowId(
      body.taskId,
      "taskId",
      "Task identifier is invalid."
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
    "Unknown timer action."
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

export function parseTaskReorderMutation(value: unknown) {
  const body = requireObject(value);
  return { ids: parseIdArray(body.ids, "ids") };
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
    value, "body", "Request body must be a JSON object.", validationError
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

function parseIdArray(value: unknown, field: "ids" | "expectedIds") {
  if (!Array.isArray(value)) {
    throw new WorkflowMutationRequestError(
      `${field === "ids" ? "Task identifiers" : "Expected task identifiers"} must be an array.`,
      field
    );
  }
  if (value.length > WORKFLOW_ID_ARRAY_MAX_ITEMS) {
    throw new WorkflowMutationRequestError(
      `No more than ${WORKFLOW_ID_ARRAY_MAX_ITEMS.toLocaleString("en-US")} task identifiers can be reordered at once.`,
      field
    );
  }
  const ids = value.map((id) =>
    parseWorkflowId(id, field, "Task identifier is invalid.")
  );
  if (new Set(ids).size !== ids.length) {
    throw new WorkflowMutationRequestError(
      "Task identifiers must not contain duplicates.",
      field
    );
  }
  return ids;
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
    throw new WorkflowMutationRequestError(
      "Task completion must be true or false.",
      field
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
  return new WorkflowMutationRequestError(message, field);
}
