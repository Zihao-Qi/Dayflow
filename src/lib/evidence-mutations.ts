import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  DEFAULT_ACTIVITY_CATEGORY
} from "@/lib/activity-categories";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import { appErrorConstructor } from "@/lib/error-compat";
import { evidenceErrors } from "@/lib/evidence-errors";
import { requestErrors } from "@/lib/request-errors";
import { AppError, validation } from "@/shared/kernel/errors";
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
export { ACTIVITY_CATEGORY_MAX_LENGTH };
export const ACTIVITY_NOTE_MAX_LENGTH = 5_000;
export const EVIDENCE_RELATION_ID_MAX_LENGTH = 191;
export const DIARY_CONTENT_MAX_LENGTH = 20_000;
export const DIARY_REFLECTION_MAX_LENGTH = 5_000;

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

export type DiaryUpsertMutation = {
  date: Date;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
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
  now = new Date()
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

export function parseDiaryUpsertMutation(
  value: unknown,
  now = new Date()
): DiaryUpsertMutation {
  const body = requireObject(value);
  return {
    date: parseDate(
      body.date,
      now,
      "date",
      evidenceErrors.diaryDateMustBeAValidCalendarDate.message
    ),
    content: parseOptionalText(
      body.content,
      "content",
      "Diary content",
      DIARY_CONTENT_MAX_LENGTH
    ),
    reflection: parseOptionalText(
      body.reflection,
      "reflection",
      "Diary reflection",
      DIARY_REFLECTION_MAX_LENGTH
    ),
    mood: parseRating(body.mood, "mood", "Mood"),
    energy: parseRating(body.energy, "energy", "Energy")
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

function parseOptionalText(
  value: unknown,
  field: "content" | "reflection",
  label: string,
  maxLength: number
) {
  if (value === undefined || value === null) return "";
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength: maxLength,
    lengthMessage: `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`,
    trim: false
  });
}

function parseRating(
  value: unknown,
  field: "mood" | "energy",
  label: string
) {
  if (value === undefined || value === null) return 3;
  return parseBoundedInteger(
    value,
    field,
    1,
    5,
    `${label} must be a whole number from 1 to 5.`
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
