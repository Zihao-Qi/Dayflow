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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new WorkflowMutationRequestError(
      "Request body must be valid JSON.",
      "body",
      "INVALID_JSON"
    );
  }
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
  if (typeof value !== "string") {
    throw new WorkflowMutationRequestError(message, field);
  }
  const id = value.trim();
  if (
    !id ||
    id.length > WORKFLOW_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new WorkflowMutationRequestError(message, field);
  }
  return id;
}

function requireObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkflowMutationRequestError(
      "Request body must be a JSON object.",
      "body"
    );
  }
  return value as JsonObject;
}

function parseOptionalWorkflowId(
  value: unknown,
  field: string,
  message: string
) {
  if (value === undefined || value === null || value === "") return null;
  return parseWorkflowId(value, field, message);
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
  if (typeof value !== "string") {
    throw new WorkflowMutationRequestError(`${label} must be text.`, field);
  }
  const text = value.trim();
  if (text.length > maximumLength) {
    throw new WorkflowMutationRequestError(
      `${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`,
      field
    );
  }
  return text;
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
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new WorkflowMutationRequestError(message, field);
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
    throw new WorkflowMutationRequestError(message, field);
  }
  return value as Values[number];
}
