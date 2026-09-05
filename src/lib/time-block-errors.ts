import { AppError, type ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the time-block boundary. Property order is wire order. */
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
