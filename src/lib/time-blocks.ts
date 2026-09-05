import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new TimeBlockError(
      "Request body must be valid JSON.",
      "INVALID_JSON",
      400,
      "body"
    );
  }
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

export function parseTimeBlockPathId(value: unknown) {
  if (typeof value !== "string") {
    throw invalidTimeBlockId();
  }
  const id = value.trim();
  if (
    !id ||
    id.length > TIME_BLOCK_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    throw invalidTimeBlockId();
  }
  return id;
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
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > TIME_BLOCK_LAST_MINUTE
  ) {
    throw new TimeBlockError(
      "Time Block minutes must identify a time from 00:00 through 23:59.",
      "VALIDATION_ERROR",
      400,
      "time"
    );
  }
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TimeBlockError(
      "Request body must be a JSON object.",
      "VALIDATION_ERROR",
      400,
      "body"
    );
  }
  return value as JsonObject;
}

function parseTimeBlockDate(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw invalidTimeBlockDate();
  }
  const date = parseLocalDate(value);
  if (!date) throw invalidTimeBlockDate();
  return date;
}

function parseTimeBlockTitle(value: unknown) {
  if (typeof value !== "string") {
    throw invalidTimeBlockTitle();
  }
  const title = value.trim();
  if (!title) throw invalidTimeBlockTitle();
  if (title.length > TIME_BLOCK_TITLE_MAX_LENGTH) {
    throw new TimeBlockError(
      `Time Block title must be ${TIME_BLOCK_TITLE_MAX_LENGTH} characters or fewer.`,
      "VALIDATION_ERROR",
      400,
      "title"
    );
  }
  return title;
}

export function parseTimeBlockTaskId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalidTimeBlockTaskId();
  const taskId = value.trim();
  if (
    !taskId ||
    taskId.length > TIME_BLOCK_TASK_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(taskId)
  ) {
    throw invalidTimeBlockTaskId();
  }
  return taskId;
}

function invalidTimeBlockDate() {
  return new TimeBlockError(
    "Time Block date must be a valid local date in YYYY-MM-DD format.",
    "VALIDATION_ERROR",
    400,
    "date"
  );
}

function invalidTimeBlockTitle() {
  return new TimeBlockError(
    "Time Block title is required.",
    "VALIDATION_ERROR",
    400,
    "title"
  );
}

function invalidTimeBlockTaskId() {
  return new TimeBlockError(
    "Task identifier is invalid.",
    "VALIDATION_ERROR",
    400,
    "taskId"
  );
}

function invalidTimeBlockId() {
  return new TimeBlockError(
    "Time Block identifier is invalid.",
    "VALIDATION_ERROR",
    400,
    "id"
  );
}

export { isTimeBlockRecord } from "@/modules/planning/ui/time-block-model";
