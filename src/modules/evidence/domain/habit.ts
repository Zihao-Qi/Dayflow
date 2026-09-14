import { addDays, parseLocalDate, startOfLocalDay } from "@/shared/kernel/calendar";
import { validation } from "@/shared/kernel/errors";
import { requestErrors } from "@/shared/kernel/request-errors";
import {
  has,
  requireObject as kernelRequireObject,
  parseBoundedInteger as kernelParseBoundedInteger,
  parseBoundedString,
  parseEnum,
  parseNullableLocalDate
} from "@/shared/kernel/parsing";
import { evidenceErrors } from "./activity";

export const HABIT_NAME_MAX_LENGTH = 120;
export const CHECK_IN_NOTE_MAX_LENGTH = 2_000;
export const CHECK_IN_AMOUNT_MAXIMUM = 1_000_000;
/** How far back a Check-in may be recorded. See docs/specs/CHECK_INS_V1.md. */
export const CHECK_IN_BACKFILL_DAYS = 7;

export const HABIT_CADENCES = ["DAILY", "TIMES_PER_WEEK"] as const;
export type HabitCadenceValue = (typeof HABIT_CADENCES)[number];

type JsonObject = Record<string, unknown>;

export type HabitCreateMutation = {
  name: string;
  cadence: HabitCadenceValue;
  targetPerWeek: number;
};

export type HabitPatchMutation = {
  name?: string;
  cadence?: HabitCadenceValue;
  targetPerWeek?: number;
  sortOrder?: number;
};

export type CheckInMutation = {
  date: Date;
  done: boolean;
  amount: number | null;
  note: string;
};

/**
 * A daily Habit is one whose target is every day, so its target is always 7.
 * Storing it as the same integer keeps consistency a single calculation
 * instead of one per cadence.
 */
export function targetForCadence(
  cadence: HabitCadenceValue,
  targetPerWeek: number
) {
  return cadence === "DAILY" ? 7 : targetPerWeek;
}

/**
 * The inclusive range a Check-in may be dated within: today back through the
 * backfill window. Days outside it are refused rather than silently dropped,
 * so a closed record stays visibly closed.
 */
export function checkInWindow(now: Date) {
  const latest = startOfLocalDay(now);
  return { earliest: addDays(latest, -CHECK_IN_BACKFILL_DAYS), latest };
}

export function parseHabitCreateMutation(value: unknown): HabitCreateMutation {
  const body = requireObject(value);
  const cadence = parseCadence(body.cadence);
  return {
    name: parseName(body.name),
    cadence,
    targetPerWeek: targetForCadence(cadence, parseTarget(body.targetPerWeek))
  };
}

export function parseHabitPatchMutation(value: unknown): HabitPatchMutation {
  const body = requireObject(value);
  const patch: HabitPatchMutation = {};
  if (has(body, "name")) patch.name = parseName(body.name);
  if (has(body, "cadence")) patch.cadence = parseCadence(body.cadence);
  if (has(body, "targetPerWeek")) {
    patch.targetPerWeek = parseTarget(body.targetPerWeek);
  }
  if (has(body, "sortOrder")) {
    patch.sortOrder = parseBoundedInteger(
      body.sortOrder,
      "sortOrder",
      0,
      10_000,
      evidenceErrors.habitSortOrderIsInvalid.message
    );
  }
  // A cadence change alone must not leave a stale target behind.
  if (patch.cadence) {
    patch.targetPerWeek = targetForCadence(
      patch.cadence,
      patch.targetPerWeek ?? 7
    );
  }
  return patch;
}

export function parseCheckInMutation(
  value: unknown,
  now: Date
): CheckInMutation {
  const body = requireObject(value);
  return {
    date: parseCheckInDate(body.date, now),
    done: parseDone(body.done),
    amount: parseAmount(body.amount),
    note: parseNote(body.note)
  };
}

function parseCheckInDate(value: unknown, now: Date) {
  const { earliest, latest } = checkInWindow(now);
  const date =
    parseNullableLocalDate(
      value,
      "date",
      evidenceErrors.checkInDateMustBeAValidCalendarDate.message,
      validationError,
      {
        nullValues: [undefined, null, ""],
        trim: true,
        parseDate: parseLocalDate
      }
    ) ?? latest;
  if (date.getTime() > latest.getTime()) {
    throw validationError(
      evidenceErrors.checkInDateCannotBeInTheFuture.message,
      "date"
    );
  }
  if (date.getTime() < earliest.getTime()) {
    throw validationError(
      evidenceErrors.checkInDateIsOutsideTheBackfillWindow.message,
      "date"
    );
  }
  return date;
}

function parseDone(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "boolean") {
    throw validationError(evidenceErrors.checkInDoneIsInvalid.message, "done");
  }
  return value;
}

/**
 * The amount is optional, and absent is not zero: a Habit recorded without a
 * number must not read as "did nothing".
 */
function parseAmount(value: unknown) {
  if (value === undefined || value === null) return null;
  return parseBoundedInteger(
    value,
    "amount",
    0,
    CHECK_IN_AMOUNT_MAXIMUM,
    evidenceErrors.checkInAmountIsInvalid.message
  );
}

function parseNote(value: unknown) {
  if (value === undefined || value === null) return "";
  return parseBoundedString(
    value,
    "note",
    evidenceErrors.checkInNoteIsInvalid.message,
    validationError,
    {
      maximumLength: CHECK_IN_NOTE_MAX_LENGTH,
      lengthMessage: evidenceErrors.checkInNoteIsTooLong.message,
      trim: false
    }
  );
}

function parseName(value: unknown) {
  return parseBoundedString(
    value,
    "name",
    evidenceErrors.habitNameIsInvalid.message,
    validationError,
    {
      maximumLength: HABIT_NAME_MAX_LENGTH,
      lengthMessage: evidenceErrors.habitNameIsTooLong.message,
      emptyMessage: evidenceErrors.habitNameIsRequired.message,
      trim: true
    }
  );
}

function parseCadence(value: unknown): HabitCadenceValue {
  if (value === undefined || value === null) return "DAILY";
  return parseEnum(
    value,
    HABIT_CADENCES,
    "cadence",
    evidenceErrors.habitCadenceIsInvalid.message,
    validationError,
    { normalize: (text) => text.trim().toUpperCase() }
  );
}

function parseTarget(value: unknown) {
  if (value === undefined || value === null) return 7;
  return parseBoundedInteger(
    value,
    "targetPerWeek",
    1,
    7,
    evidenceErrors.habitTargetPerWeekIsInvalid.message
  );
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
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
