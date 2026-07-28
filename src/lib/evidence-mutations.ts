import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

export const ACTIVITY_DURATION_MAX_MINUTES = 1_440;
export const ACTIVITY_CATEGORY_MAX_LENGTH = 100;
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new EvidenceMutationRequestError(
      "Request body must be valid JSON.",
      "body",
      "INVALID_JSON"
    );
  }
  return requireObject(body);
}

export function parseActivityCreateMutation(
  value: unknown,
  now = new Date()
): ActivityCreateMutation {
  const body = requireObject(value);
  const date = parseDate(
    body.date,
    now,
    "date",
    "Activity date is invalid."
  );
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EvidenceMutationRequestError(
      "Request body must be a JSON object.",
      "body"
    );
  }
  return value as JsonObject;
}

function parseDate(
  value: unknown,
  now: Date,
  field: "date",
  message: string
) {
  if (value === undefined || value === null || value === "") {
    return startOfLocalDay(now);
  }
  if (typeof value !== "string") {
    throw new EvidenceMutationRequestError(message, field);
  }
  const date = parseLocalDate(value.trim());
  if (!date) {
    throw new EvidenceMutationRequestError(message, field);
  }
  return date;
}

function parseActivityTime(value: unknown, now: Date) {
  if (value === undefined || value === null || value === "") {
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }
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
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function parseActivityCategory(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "Deep Work";
  }
  if (typeof value !== "string") {
    throw new EvidenceMutationRequestError(
      "Activity category must be text.",
      "category"
    );
  }
  const category = value.trim() || "Deep Work";
  if (category.length > ACTIVITY_CATEGORY_MAX_LENGTH) {
    throw new EvidenceMutationRequestError(
      `Activity category must be ${ACTIVITY_CATEGORY_MAX_LENGTH} characters or fewer.`,
      "category"
    );
  }
  return category;
}

function parseActivityNote(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new EvidenceMutationRequestError(
      "Add a short note about what happened.",
      "note"
    );
  }
  const note = value.trim();
  if (note.length > ACTIVITY_NOTE_MAX_LENGTH) {
    throw new EvidenceMutationRequestError(
      `Activity note must be ${ACTIVITY_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`,
      "note"
    );
  }
  return note;
}

function parseRelationshipId(
  value: unknown,
  field: "taskId" | "projectId",
  label: "Task" | "Project"
) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new EvidenceMutationRequestError(
      `${label} identifier is invalid.`,
      field
    );
  }
  const id = value.trim();
  if (
    !id ||
    id.length > EVIDENCE_RELATION_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new EvidenceMutationRequestError(
      `${label} identifier is invalid.`,
      field
    );
  }
  return id;
}

function parseOptionalText(
  value: unknown,
  field: "content" | "reflection",
  label: string,
  maxLength: number
) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new EvidenceMutationRequestError(`${label} must be text.`, field);
  }
  if (value.length > maxLength) {
    throw new EvidenceMutationRequestError(
      `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`,
      field
    );
  }
  return value;
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
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new EvidenceMutationRequestError(message, field);
  }
  return value;
}
