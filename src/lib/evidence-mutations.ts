import {
  requireObject as kernelRequireObject,
  readJsonBody,
  parseBoundedInteger as kernelParseBoundedInteger,
  has,
  parseRecordId,
  parseBoundedString,
  parseNullableLocalDate
} from "@/shared/kernel/parsing";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  DEFAULT_ACTIVITY_CATEGORY
} from "@/lib/activity-categories";

export const ACTIVITY_DURATION_MAX_MINUTES = 1_440;
export { ACTIVITY_CATEGORY_MAX_LENGTH };
export const ACTIVITY_NOTE_MAX_LENGTH = 5_000;
export const EVIDENCE_RELATION_ID_MAX_LENGTH = 191;
export const DIARY_CONTENT_MAX_LENGTH = 20_000;
export const DIARY_REFLECTION_MAX_LENGTH = 5_000;

export type EvidenceMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR";

export class EvidenceMutationRequestError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code: EvidenceMutationErrorCode = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "EvidenceMutationRequestError";
  }
}

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
    "Request body must be valid JSON.",
    (message, field) =>
      new EvidenceMutationRequestError(message, field, "INVALID_JSON")
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
      `Duration must be between 1 and ${ACTIVITY_DURATION_MAX_MINUTES} minutes.`
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
      `Duration must be between 1 and ${ACTIVITY_DURATION_MAX_MINUTES} minutes.`
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
      "Diary date must be a valid calendar date."
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
    value, "body", "Request body must be a JSON object.", validationError
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
    throw new EvidenceMutationRequestError(
      "Activity date is invalid.",
      "date"
    );
  }
  const date = parseDate(
    value,
    now,
    "date",
    "Activity date is invalid."
  );
  if (date.getTime() > startOfLocalDay(now).getTime()) {
    throw new EvidenceMutationRequestError(
      "Activity date cannot be in the future.",
      "date"
    );
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
    throw new EvidenceMutationRequestError(
      "Activity start time is invalid.",
      "startTime"
    );
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new EvidenceMutationRequestError(
      "Activity start time is invalid.",
      "startTime"
    );
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
    "Activity category must be text.",
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
    "Add a short note about what happened.",
    validationError,
    {
      maximumLength: ACTIVITY_NOTE_MAX_LENGTH,
      lengthMessage: `Activity note must be ${ACTIVITY_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`,
      emptyMessage: "Add a short note about what happened.",
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
    throw new EvidenceMutationRequestError(
      `${label} relationship is required.`,
      field
    );
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
  return new EvidenceMutationRequestError(message, field);
}
