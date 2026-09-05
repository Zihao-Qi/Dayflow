import {
  requireObject as kernelRequireObject,
  readJsonBody,
  parseBoundedInteger,
  parseRecordId,
  parseBoundedString,
  parseNullableLocalDate
} from "@/shared/kernel/parsing";
import {
  localDateKey,
  parseLocalDate,
  startOfLocalDay
} from "@/lib/dates";

export const TIME_BLOCK_TITLE_MAX_LENGTH = 500;
export const TIME_BLOCK_ID_MAX_LENGTH = 191;
export const TIME_BLOCK_TASK_ID_MAX_LENGTH = 191;
export const TIME_BLOCK_SLOT_INTERVAL_MINUTES = 15;
export const TIME_BLOCK_LAST_MINUTE = 23 * 60 + 59;

type JsonObject = Record<string, unknown>;

export type TimeBlockDraft = {
  date: Date;
  startTime: string;
  endTime: string;
  title: string;
  taskId: string | null;
};

export type TimeBlockInterval = {
  startTime: string;
  endTime: string;
};

export type TimeBlockTaskSummary = {
  id: string;
  title: string;
  estimateMinutes: number;
};

export type TimeBlockRecord = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  taskId: string | null;
  createdAt: string;
  task: TimeBlockTaskSummary | null;
};

export type MinuteInterval = {
  startMinutes: number;
  endMinutes: number;
};

export type TimeBlockErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "RELATIONSHIP_NOT_FOUND"
  | "RELATIONSHIP_CONFLICT"
  | "TIME_BLOCK_OVERLAP";

export class TimeBlockError extends Error {
  constructor(
    message: string,
    readonly code: TimeBlockErrorCode,
    readonly status: 400 | 404 | 409,
    readonly field?: string
  ) {
    super(message);
    this.name = "TimeBlockError";
  }
}

export async function readTimeBlockMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  const body = await readJsonBody(
    request,
    "body",
    "Request body must be valid JSON.",
    (message, field) =>
      new TimeBlockError(message, "INVALID_JSON", 400, field)
  );
  return requireObject(body);
}

export function parseTimeBlockDraft(
  value: unknown,
  now = new Date()
): TimeBlockDraft {
  const draft = parseTimeBlockDraftStructure(value);
  assertTimeBlockIsNotPast(draft, now);
  return draft;
}

export function parseTimeBlockDraftStructure(
  value: unknown
): TimeBlockDraft {
  const body = requireObject(value);
  const date = parseTimeBlockDate(body.date);
  const startTime = parseTimeBlockTime(body.startTime, "startTime");
  const endTime = parseTimeBlockTime(body.endTime, "endTime");

  if (timeBlockTimeToMinutes(startTime) >= timeBlockTimeToMinutes(endTime)) {
    throw new TimeBlockError(
      "Time Block end time must be later than its start time.",
      "VALIDATION_ERROR",
      400,
      "endTime"
    );
  }

  return {
    date,
    startTime,
    endTime,
    title: parseTimeBlockTitle(body.title),
    taskId: parseTimeBlockTaskId(body.taskId)
  };
}

/**
 * A Time Block may be planned for today or any later day, never for a day that
 * has ended.
 *
 * Manual Time Blocks v1 restricted this to today alone, which made planning a
 * future day impossible. Day Navigation v1 widens it forward only: a plan for
 * a day that is over is not a plan, and Evidence Integrity keeps the past a
 * record rather than something to fill in.
 *
 * The eight-week navigation horizon is deliberately not enforced here. That
 * bound governs how far Log travels, not what a stored plan may say.
 */
export function assertTimeBlockIsNotPast(
  draft: Pick<TimeBlockDraft, "date">,
  now = new Date()
) {
  if (draft.date.getTime() < startOfLocalDay(now).getTime()) {
    throw new TimeBlockError(
      "Time Blocks cannot be planned for a day that has already ended.",
      "VALIDATION_ERROR",
      400,
      "date"
    );
  }
}

export function isTimeBlockRecord(value: unknown): value is TimeBlockRecord {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<TimeBlockRecord>;
  try {
    const parsedDate = parseLocalDate(block.date);
    const canonicalId =
      typeof block.id === "string" ? parseTimeBlockPathId(block.id) : null;
    const canonicalTaskId =
      block.taskId === null
        ? null
        : parseTimeBlockTaskId(block.taskId);
    const startTime = parseTimeBlockTime(block.startTime, "startTime");
    const endTime = parseTimeBlockTime(block.endTime, "endTime");
    if (
      canonicalId !== block.id ||
      !parsedDate ||
      localDateKey(parsedDate) !== block.date ||
      startTime !== block.startTime ||
      endTime !== block.endTime ||
      timeBlockTimeToMinutes(startTime) >= timeBlockTimeToMinutes(endTime) ||
      typeof block.title !== "string" ||
      !block.title ||
      block.title.trim() !== block.title ||
      block.title.length > TIME_BLOCK_TITLE_MAX_LENGTH ||
      canonicalTaskId !== block.taskId ||
      typeof block.createdAt !== "string" ||
      !isCanonicalIsoDate(block.createdAt)
    ) {
      return false;
    }

    if (block.task === null) return block.taskId === null;
    if (!block.task || typeof block.task !== "object") return false;
    return (
      block.taskId !== null &&
      block.task.id === block.taskId &&
      parseTimeBlockPathId(block.task.id) === block.task.id &&
      typeof block.task.title === "string" &&
      Boolean(block.task.title.trim()) &&
      Number.isInteger(block.task.estimateMinutes) &&
      block.task.estimateMinutes >= 0
    );
  } catch {
    return false;
  }
}

export function parseTimeBlockPathId(value: unknown) {
  return parseRecordId(
    value,
    "id",
    "Time Block identifier is invalid.",
    validationError,
    {
      maximumLength: TIME_BLOCK_ID_MAX_LENGTH,
      rejectControlCharacters: true
    }
  );
}

export function parseTimeBlockTime(
  value: unknown,
  field: "startTime" | "endTime"
) {
  if (
    typeof value !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    throw new TimeBlockError(
      `Time Block ${field === "startTime" ? "start" : "end"} time must use HH:mm.`,
      "VALIDATION_ERROR",
      400,
      field
    );
  }
  return value;
}

export function timeBlockTimeToMinutes(value: string) {
  const canonical = parseTimeBlockTime(value, "startTime");
  const [hours, minutes] = canonical.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTimeBlockTime(value: number) {
  parseBoundedInteger(
    value, "time", 0, TIME_BLOCK_LAST_MINUTE,
    "Time Block minutes must identify a time from 00:00 through 23:59.", validationError
  );
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeBlockIntervalToMinutes(
  interval: TimeBlockInterval
): MinuteInterval {
  const startTime = parseTimeBlockTime(interval.startTime, "startTime");
  const endTime = parseTimeBlockTime(interval.endTime, "endTime");
  const result = {
    startMinutes: timeBlockTimeToMinutes(startTime),
    endMinutes: timeBlockTimeToMinutes(endTime)
  };
  if (result.startMinutes >= result.endMinutes) {
    throw new TimeBlockError(
      "Time Block end time must be later than its start time.",
      "VALIDATION_ERROR",
      400,
      "endTime"
    );
  }
  return result;
}

export function timeBlockDurationMinutes(interval: TimeBlockInterval) {
  const { startMinutes, endMinutes } =
    timeBlockIntervalToMinutes(interval);
  return endMinutes - startMinutes;
}

export function minuteIntervalsOverlap(
  left: MinuteInterval,
  right: MinuteInterval
) {
  return (
    left.startMinutes < right.endMinutes &&
    right.startMinutes < left.endMinutes
  );
}

export function timeBlockIntervalsOverlap(
  left: TimeBlockInterval,
  right: TimeBlockInterval
) {
  return minuteIntervalsOverlap(
    timeBlockIntervalToMinutes(left),
    timeBlockIntervalToMinutes(right)
  );
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", "Request body must be a JSON object.", validationError
  );
}

function parseTimeBlockDate(value: unknown) {
  return parseNullableLocalDate(
    value,
    "date",
    "Time Block date must be a valid local date in YYYY-MM-DD format.",
    validationError,
    {
      nullValues: [],
      trim: false,
      parseDate: parseLocalDate,
      dateOnly: true
    }
  )!;
}

function parseTimeBlockTitle(value: unknown) {
  return parseBoundedString(
    value,
    "title",
    "Time Block title is required.",
    validationError,
    {
      maximumLength: TIME_BLOCK_TITLE_MAX_LENGTH,
      lengthMessage: `Time Block title must be ${TIME_BLOCK_TITLE_MAX_LENGTH} characters or fewer.`,
      emptyMessage: "Time Block title is required.",
      trim: true
    }
  );
}

function parseTimeBlockTaskId(value: unknown) {
  return parseRecordId(value, "taskId", "Task identifier is invalid.", validationError, {
    maximumLength: TIME_BLOCK_TASK_ID_MAX_LENGTH,
    rejectControlCharacters: true,
    nullValues: [undefined, null, ""]
  });
}

function isCanonicalIsoDate(value: string) {
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value
  );
}

function validationError(message: string, field: string) {
  return new TimeBlockError(message, "VALIDATION_ERROR", 400, field);
}
