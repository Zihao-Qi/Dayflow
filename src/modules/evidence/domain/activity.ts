import { parseLocalDate, startOfLocalDay } from "@/shared/kernel/calendar";
import { appErrorConstructor } from "@/shared/kernel/error-compat";
import { requestErrors } from "@/shared/kernel/request-errors";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import {
  has,
  parseBoundedInteger as kernelParseBoundedInteger,
  requireObject as kernelRequireObject,
  parseBoundedString,
  parseNullableLocalDate,
  parseRecordId,
  readJsonBody
} from "@/shared/kernel/parsing";

export const ACTIVITY_DURATION_MAX_MINUTES = 1_440;
export const ACTIVITY_NOTE_MAX_LENGTH = 5_000;
export const EVIDENCE_RELATION_ID_MAX_LENGTH = 191;

export type EvidenceMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const EvidenceMutationRequestError = appErrorConstructor(
  (
    message: string,
    field: string,
    code: EvidenceMutationErrorCode = "VALIDATION_ERROR"
  ) => new AppError({ status: 400, message, code, field })
);
export type EvidenceMutationRequestError = AppError;

export type ActivityCreateMutation = {
  startedAt: Date;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
};

export type ActivityReplaceMutation = {
  startTime: string;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
};

type JsonObject = Record<string, unknown>;

export async function readEvidenceMutationBody(request: {
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

export function parseActivityCreateMutation(
  value: unknown,
  now: Date
): ActivityCreateMutation {
  const body = requireObject(value);
  const date = parseActivityDate(body.date, now);
  const time = parseActivityTime(body.startTime, now);
  const startedAt = startOfLocalDay(date);
  startedAt.setHours(time.hours, time.minutes, 0, 0);

  return {
    startedAt,
    durationMinutes: parseBoundedInteger(
      body.durationMinutes,
      "durationMinutes",
      1,
      ACTIVITY_DURATION_MAX_MINUTES,
      evidenceErrors.durationMustBeBetween1And1440Minutes.message
    ),
    category: parseActivityCategory(body.category),
    note: parseActivityNote(body.note),
    taskId: parseRelationshipId(body.taskId, "taskId", "Task"),
    projectId: parseRelationshipId(body.projectId, "projectId", "Project")
  };
}

export function parseActivityReplaceMutation(
  value: unknown
): ActivityReplaceMutation {
  const body = requireObject(value);
  return {
    startTime: parseRequiredActivityTime(body.startTime),
    durationMinutes: parseBoundedInteger(
      body.durationMinutes,
      "durationMinutes",
      1,
      ACTIVITY_DURATION_MAX_MINUTES,
      evidenceErrors.durationMustBeBetween1And1440Minutes.message
    ),
    category: parseRequiredActivityCategory(body.category),
    note: parseActivityNote(body.note),
    taskId: parseRequiredRelationshipId(body, "taskId", "Task"),
    projectId: parseRequiredRelationshipId(body, "projectId", "Project")
  };
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseDate(
  value: unknown,
  now: Date,
  field: "date",
  message: string
) {
  return parseNullableLocalDate(value, field, message, validationError, {
    nullValues: [undefined, null, ""],
    trim: true,
    parseDate: parseLocalDate
  }) ?? startOfLocalDay(now);
}

function parseActivityDate(value: unknown, now: Date) {
  if (typeof value === "string" && !value.trim()) {
    throw new AppError(evidenceErrors.activityDateIsInvalid);
  }
  const date = parseDate(
    value,
    now,
    "date",
    evidenceErrors.activityDateIsInvalid.message
  );
  if (date.getTime() > startOfLocalDay(now).getTime()) {
    throw new AppError(evidenceErrors.activityDateCannotBeInTheFuture);
  }
  return date;
}

function parseActivityTime(value: unknown, now: Date) {
  if (value === undefined || value === null || value === "") {
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }
  const startTime = parseRequiredActivityTime(value);
  return {
    hours: Number(startTime.slice(0, 2)),
    minutes: Number(startTime.slice(3, 5))
  };
}

function parseRequiredActivityTime(value: unknown) {
  if (typeof value !== "string") {
    throw new AppError(evidenceErrors.activityStartTimeIsInvalid);
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new AppError(evidenceErrors.activityStartTimeIsInvalid);
  }
  return value;
}

function parseActivityCategory(value: unknown) {
  if (value === undefined || value === null) return DEFAULT_ACTIVITY_CATEGORY;
  return parseRequiredActivityCategory(value);
}

function parseRequiredActivityCategory(value: unknown) {
  return parseBoundedString(
    value,
    "category",
    evidenceErrors.activityCategoryMustBeText.message,
    validationError,
    {
      maximumLength: ACTIVITY_CATEGORY_MAX_LENGTH,
      lengthMessage: `Activity category must be ${ACTIVITY_CATEGORY_MAX_LENGTH} characters or fewer.`,
      emptyMessage: "Choose an Activity category.",
      trim: true
    }
  );
}

function parseActivityNote(value: unknown) {
  return parseBoundedString(
    value,
    "note",
    evidenceErrors.addAShortNoteAboutWhatHappened.message,
    validationError,
    {
      maximumLength: ACTIVITY_NOTE_MAX_LENGTH,
      lengthMessage: `Activity note must be ${ACTIVITY_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`,
      emptyMessage: evidenceErrors.addAShortNoteAboutWhatHappened.message,
      trim: true
    }
  );
}

function parseRelationshipId(
  value: unknown,
  field: "taskId" | "projectId",
  label: "Task" | "Project"
) {
  return parseRecordId(value, field, `${label} identifier is invalid.`, validationError, {
    maximumLength: EVIDENCE_RELATION_ID_MAX_LENGTH,
    rejectControlCharacters: true,
    nullValues: [undefined, null, ""]
  });
}

function parseRequiredRelationshipId(
  body: JsonObject,
  field: "taskId" | "projectId",
  label: "Task" | "Project"
) {
  if (!has(body, field)) {
    throw validation(`${label} relationship is required.`, field);
  }
  return parseRecordId(
    body[field],
    field,
    `${label} identifier is invalid.`,
    validationError,
    {
      maximumLength: EVIDENCE_RELATION_ID_MAX_LENGTH,
      rejectControlCharacters: true,
      nullValues: [null]
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

function validationError(message: string, field: string) {
  return validation(message, field);
}

export const ACTIVITY_CATEGORY_MAX_LENGTH = 100;
export const DEFAULT_ACTIVITY_CATEGORIES = [
  "Deep Work",
  "Learning",
  "Admin",
  "Health",
  "Rest"
] as const;
export const DEFAULT_ACTIVITY_CATEGORY = DEFAULT_ACTIVITY_CATEGORIES[0];

export function buildActivityCategorySuggestions(
  persistedLabels: readonly string[]
) {
  const suggestions = [...DEFAULT_ACTIVITY_CATEGORIES] as string[];
  const seen = new Set(
    DEFAULT_ACTIVITY_CATEGORIES.map(categorySuggestionKey)
  );
  const custom = persistedLabels
    .map((label) => label.trim())
    .filter(
      (label) =>
        label.length > 0 &&
        label.length <= ACTIVITY_CATEGORY_MAX_LENGTH
    )
    .sort(
      (left, right) =>
        left.localeCompare(right, "en-US", { sensitivity: "base" }) ||
        left.localeCompare(right, "en-US")
    );

  for (const label of custom) {
    const key = categorySuggestionKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(label);
  }
  return suggestions;
}

function categorySuggestionKey(value: string) {
  return value.toLocaleLowerCase("en-US");
}


/** Exact envelopes owned by the evidence boundary. Property order is wire order. */
export const evidenceErrors = {
  activityNotFound: {
    status: 404,
    message: "Activity not found.",
    code: "ACTIVITY_NOT_FOUND"
  },
  focusEvidenceCannotBeEditedHere: {
    status: 409,
    message: "Focus evidence cannot be edited here.",
    code: "FOCUS_ACTIVITY_PROTECTED"
  },
  theActivityChangedBeforeItCouldBeUpdated: {
    status: 409,
    message: "The Activity changed before it could be updated.",
    code: "CONFLICT"
  },
  theLinkedTaskCouldNotBeFound: {
    status: 404,
    message: "The linked task could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "taskId"
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    message: "The selected task belongs to a different project.",
    code: "ATTRIBUTION_CONFLICT",
    field: "projectId"
  },
  theLinkedProjectCouldNotBeFound: {
    status: 404,
    message: "The linked project could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "projectId"
  },
  activityDateIsInvalid: {
    status: 400,
    message: "Activity date is invalid.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  activityDateCannotBeInTheFuture: {
    status: 400,
    message: "Activity date cannot be in the future.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  activityStartTimeIsInvalid: {
    status: 400,
    message: "Activity start time is invalid.",
    code: "VALIDATION_ERROR",
    field: "startTime"
  },
  theActivityChangedBeforeItCouldBeDeleted: {
    status: 409,
    message: "The Activity changed before it could be deleted.",
    code: "CONFLICT"
  },
  activityDeleteNotFound: {
    status: 404,
    message: "Activity not found."
  },
  focusEvidenceCannotBeDeleted: {
    status: 409,
    message: "Focus evidence cannot be deleted."
  },
  activityCouldNotBeDeleted: {
    status: 500,
    message: "Activity could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  diaryCouldNotBeSaved: {
    status: 500,
    message: "Diary could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theLinkedActivityRelationshipIsNoLongerAvailable: {
    status: 409,
    message: "The linked Activity relationship is no longer available.",
    code: "RELATIONSHIP_CONFLICT"
  },
  activityCreateFailed: {
    status: 500,
    message: "Activity could not be saved.",
    code: "INTERNAL_ERROR"
  },
  activityReplaceFailed: {
    status: 500,
    message: "Activity could not be updated.",
    code: "INTERNAL_ERROR"
  },
  activityIdentifierIsInvalid: {
    status: 400,
    message: "Activity identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  diaryDateMustBeAValidCalendarDate: {
    status: 400,
    message: "Diary date must be a valid calendar date.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  durationMustBeBetween1And1440Minutes: {
    status: 400,
    message: "Duration must be between 1 and 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "durationMinutes"
  },
  activityCategoryMustBeText: {
    status: 400,
    message: "Activity category must be text.",
    code: "VALIDATION_ERROR",
    field: "category"
  },
  addAShortNoteAboutWhatHappened: {
    status: 400,
    message: "Add a short note about what happened.",
    code: "VALIDATION_ERROR",
    field: "note"
  }
} as const satisfies Record<string, ErrorSpec>;

export type EvidenceAttributionErrorCode =
  | "RELATIONSHIP_NOT_FOUND"
  | "ATTRIBUTION_CONFLICT";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const EvidenceAttributionError = appErrorConstructor(
  (
    message: string,
    code: EvidenceAttributionErrorCode,
    field: "taskId" | "projectId",
    status: 404 | 409
  ) => new AppError({ status, message, code, field })
);
export type EvidenceAttributionError = AppError;

export type ActivityPersistenceErrorCode =
  | "ACTIVITY_NOT_FOUND"
  | "FOCUS_ACTIVITY_PROTECTED"
  | "CONFLICT";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const ActivityPersistenceError = appErrorConstructor(
  (
    message: string,
    code: ActivityPersistenceErrorCode,
    status: 404 | 409
  ) => new AppError({ status, message, code }),
  (error) => ["ACTIVITY_NOT_FOUND", "FOCUS_ACTIVITY_PROTECTED", "CONFLICT"].includes(error.code ?? "")
);
export type ActivityPersistenceError = AppError;


export type ActivityEntry = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  origin: "MANUAL" | "FOCUS";
  taskId: string | null;
  projectId: string | null;
  attributedProjectId: string | null;
  focusSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isActivityResponse(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<ActivityEntry>;
  return (
    typeof activity.id === "string" &&
    typeof activity.startedAt === "string" &&
    Number.isInteger(activity.durationMinutes) &&
    typeof activity.category === "string" &&
    typeof activity.note === "string" &&
    ["MANUAL", "FOCUS"].includes(String(activity.origin)) &&
    (activity.taskId === null || typeof activity.taskId === "string") &&
    (activity.projectId === null || typeof activity.projectId === "string") &&
    (activity.attributedProjectId === null ||
      typeof activity.attributedProjectId === "string") &&
    (activity.focusSessionId === null ||
      typeof activity.focusSessionId === "string") &&
    typeof activity.createdAt === "string" &&
    Number.isFinite(Date.parse(activity.createdAt)) &&
    typeof activity.updatedAt === "string" &&
    Number.isFinite(Date.parse(activity.updatedAt))
  );
}


/** Focus-origin evidence cannot be changed through manual Activity operations. */
export function isFocusActivityProtected(activity: { origin: "MANUAL" | "FOCUS"; focusSessionId: string | null }) {
  return activity.origin === "FOCUS" || Boolean(activity.focusSessionId);
}

export function normalizeEvidenceRelationshipIds(taskValue: unknown, projectValue: unknown) {
  return { taskId: String(taskValue ?? "").trim() || null, projectId: String(projectValue ?? "").trim() || null };
}

/** Resolve attribution from supplied relationship snapshots, without performing reads. */
export function resolveTaskProjectAttribution(
  taskValue: unknown,
  projectValue: unknown,
  relationships: { task: { id: string; projectId: string | null } | null; project: { id: string } | null }
) {
  const normalized = normalizeEvidenceRelationshipIds(taskValue, projectValue);
  const taskId = normalized.taskId;
  let projectId = normalized.projectId;
  let attributedProjectId = projectId;
  if (taskId) {
    const task = relationships.task;
    if (!task) throw new AppError(evidenceErrors.theLinkedTaskCouldNotBeFound);
    if (task.projectId) {
      if (projectId && projectId !== task.projectId) {
        throw new AppError(evidenceErrors.theSelectedTaskBelongsToADifferentProject);
      }
      projectId = null;
      attributedProjectId = task.projectId;
    }
  }
  if (projectId && !relationships.project) throw new AppError(evidenceErrors.theLinkedProjectCouldNotBeFound);
  return { taskId, projectId, attributedProjectId };
}
