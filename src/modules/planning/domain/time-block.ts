import {
  localDateKey,
  parseLocalDate,
  startOfLocalDay,
  type LocalDay
} from "@/shared/kernel/calendar";
import { appErrorConstructor } from "@/shared/kernel/error-compat";
import { requestErrors } from "@/shared/kernel/request-errors";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import {
  requireObject as kernelRequireObject,
  parseBoundedInteger,
  parseBoundedString,
  parseNullableLocalDate,
  parseRecordId,
  readJsonBody
} from "@/shared/kernel/parsing";

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
  // User-supplied title snapshot: never derived again from the linked Task.
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
  date: LocalDay;
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

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const TimeBlockError = appErrorConstructor(
  (
    message: string,
    code: TimeBlockErrorCode,
    status: 400 | 404 | 409,
    field?: string
  ) => new AppError({ status, message, code, ...(field ? { field } : {}) })
);
export type TimeBlockError = AppError;

export async function readTimeBlockMutationBody(request: {
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

export function parseTimeBlockDraft(
  value: unknown,
  now: Date
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
    throw new AppError(timeBlockErrors.timeBlockEndTimeMustBeLaterThanItsStartTime);
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
  now: Date
) {
  if (draft.date.getTime() < startOfLocalDay(now).getTime()) {
    throw new AppError(timeBlockErrors.timeBlocksCannotBePlannedForADayThatHasAlready);
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
    timeBlockErrors.timeBlockIdentifierIsInvalid.message,
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
    throw validation(`Time Block ${field === "startTime" ? "start" : "end"} time must use HH:mm.`, field);
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
    timeBlockErrors.timeBlockMinutesMustIdentifyATimeFrom0000Through2359.message, validationError
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
    throw new AppError(timeBlockErrors.timeBlockEndTimeMustBeLaterThanItsStartTime);
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
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseTimeBlockDate(value: unknown) {
  return parseNullableLocalDate(
    value,
    "date",
    timeBlockErrors.timeBlockDateMustBeAValidLocalDateInYYYYMMDD.message,
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
    timeBlockErrors.timeBlockTitleIsRequired.message,
    validationError,
    {
      maximumLength: TIME_BLOCK_TITLE_MAX_LENGTH,
      lengthMessage: `Time Block title must be ${TIME_BLOCK_TITLE_MAX_LENGTH} characters or fewer.`,
      emptyMessage: timeBlockErrors.timeBlockTitleIsRequired.message,
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
  return validation(message, field);
}


/** Exact envelopes owned by the time-block boundary. The serializer emits exactly the declared properties. */
export const timeBlockErrors = {
  timeBlockNotFound: {
    status: 404,
    message: "Time Block not found.",
    code: "NOT_FOUND",
    field: "id"
  },
  theSelectedTaskCouldNotBeFound: {
    status: 404,
    message: "The selected Task could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "taskId"
  },
  chooseAnUnfinishedTaskScheduledForTheSameDayAsThe: {
    status: 409,
    message: "Choose an unfinished Task scheduled for the same day as the Time Block.",
    code: "RELATIONSHIP_CONFLICT",
    field: "taskId"
  },
  timeBlockEndTimeMustBeLaterThanItsStartTime: {
    status: 400,
    message: "Time Block end time must be later than its start time.",
    code: "VALIDATION_ERROR",
    field: "endTime"
  },
  timeBlocksCannotBePlannedForADayThatHasAlready: {
    status: 400,
    message: "Time Blocks cannot be planned for a day that has already ended.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  timeBlockCouldNotBeCreated: {
    status: 500,
    message: "Time Block could not be created.",
    code: "INTERNAL_ERROR"
  },
  timeBlockCouldNotBeDeleted: {
    status: 500,
    message: "Time Block could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  timeBlockCouldNotBeSaved: {
    status: 500,
    message: "Time Block could not be saved.",
    code: "INTERNAL_ERROR"
  },
  timeBlockNotFoundWithoutField: {
    status: 404,
    message: "Time Block not found.",
    code: "NOT_FOUND"
  },
  overlap: {
    status: 409,
    message: "This Time Block overlaps \"{title}\" at {startTime}–{endTime}.",
    code: "TIME_BLOCK_OVERLAP",
    field: "startTime"
  },
  timeBlockDateMustBeAValidLocalDateInYYYYMMDD: {
    status: 400,
    message: "Time Block date must be a valid local date in YYYY-MM-DD format.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  timeBlockIdentifierIsInvalid: {
    status: 400,
    message: "Time Block identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  timeBlockMinutesMustIdentifyATimeFrom0000Through2359: {
    status: 400,
    message: "Time Block minutes must identify a time from 00:00 through 23:59.",
    code: "VALIDATION_ERROR",
    field: "time"
  },
  timeBlockTitleIsRequired: {
    status: 400,
    message: "Time Block title is required.",
    code: "VALIDATION_ERROR",
    field: "title"
  }
} as const satisfies Record<string, ErrorSpec>;

export function timeBlockOverlapError(block: { title: string; startTime: string; endTime: string }) {
  const spec = timeBlockErrors.overlap;
  return new AppError({ ...spec, message: spec.message.replace(/\{(title|startTime|endTime)\}/g, (_token, key: keyof typeof block) => block[key]) });
}

type PersistedTimeBlock = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  title: string;
  taskId: string | null;
  createdAt: Date;
  task: {
    id: string;
    title: string;
    estimateMinutes: number;
  } | null;
};


export function serializeTimeBlock(timeBlock: PersistedTimeBlock): TimeBlockRecord {
  return {
    id: timeBlock.id,
    date: localDateKey(timeBlock.date) as LocalDay,
    startTime: timeBlock.startTime,
    endTime: timeBlock.endTime,
    title: timeBlock.title,
    taskId: timeBlock.taskId,
    createdAt: timeBlock.createdAt.toISOString(),
    task: timeBlock.task
  };
}


/** A retained link survives Task completion/rescheduling; new links must match. */
export function assertTimeBlockTaskRelationship(
  input: TimeBlockDraft,
  task: { status: string; date: Date | null },
  retainedTaskId: string | null
) {
  if (input.taskId !== retainedTaskId &&
      (task.status === "DONE" || task.date?.getTime() !== input.date.getTime())) {
    throw new AppError(timeBlockErrors.chooseAnUnfinishedTaskScheduledForTheSameDayAsThe);
  }
}
