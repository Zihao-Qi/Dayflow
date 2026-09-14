import {
  addDays,
  localDateKey,
  parseLocalDate,
  startOfLocalDay
} from "@/shared/kernel/calendar";
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
  /** Both optional fields use null for absent, never a zero or empty string. */
  amount: number | null;
  note: string | null;
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

export type HabitDefinition = {
  id: string;
  name: string;
  cadence: HabitCadenceValue;
  targetPerWeek: number;
  sortOrder: number;
  createdAt: Date;
};

export type CheckInRecord = {
  habitId: string;
  date: Date;
  done: boolean;
  amount: number | null;
  note: string | null;
};

/**
 * `unrecorded` and `notDone` are separate states on purpose. A read model may
 * present both as a miss, but it must be able to tell them apart, because that
 * distinction is the reason absence is not stored as failure.
 * `outOfScope` covers days that have not happened yet and days before the
 * Habit existed; neither can be a miss.
 */
export type CheckInDayState = "done" | "notDone" | "unrecorded" | "outOfScope";

export type HabitDay = {
  day: string;
  state: CheckInDayState;
  amount: number | null;
};

export type HabitSummary = {
  id: string;
  name: string;
  cadence: HabitCadenceValue;
  targetPerWeek: number;
  sortOrder: number;
  today: { done: boolean; amount: number | null; note: string | null } | null;
  days: HabitDay[];
  doneCount: number;
  target: number;
};

/**
 * A daily Habit's target grows with the period: three days in, it is three,
 * because a day that has not happened cannot have been missed. A
 * times-per-week Habit keeps its weekly goal, since those days may be used in
 * any order and the week is not over.
 */
export function habitTarget(
  habit: Pick<HabitDefinition, "cadence" | "targetPerWeek">,
  countableDays: number
) {
  return habit.cadence === "DAILY"
    ? countableDays
    : Math.min(habit.targetPerWeek, 7);
}

export function summarizeHabits(
  habits: readonly HabitDefinition[],
  checkIns: readonly CheckInRecord[],
  periodStart: Date,
  today: Date,
  days = 7
): HabitSummary[] {
  const todayKey = localDateKey(today);
  return habits.map((habit) => {
    const rows = new Map(
      checkIns
        .filter((row) => row.habitId === habit.id)
        .map((row) => [localDateKey(row.date), row])
    );
    const createdKey = localDateKey(habit.createdAt);
    const dayStates: HabitDay[] = Array.from({ length: days }, (_, index) => {
      const day = localDateKey(addDays(periodStart, index));
      const row = rows.get(day);
      if (row) {
        return {
          day,
          state: row.done ? "done" : "notDone",
          amount: row.amount
        };
      }
      const future = day > todayKey;
      const beforeHabit = day < createdKey;
      return {
        day,
        state: future || beforeHabit ? "outOfScope" : "unrecorded",
        amount: null
      };
    });
    const countableDays = dayStates.filter(
      (entry) => entry.state !== "outOfScope"
    ).length;
    const todayRow = rows.get(todayKey);
    return {
      id: habit.id,
      name: habit.name,
      cadence: habit.cadence,
      targetPerWeek: habit.targetPerWeek,
      sortOrder: habit.sortOrder,
      today: todayRow
        ? { done: todayRow.done, amount: todayRow.amount, note: todayRow.note }
        : null,
      days: dayStates,
      doneCount: dayStates.filter((entry) => entry.state === "done").length,
      target: habitTarget(habit, countableDays)
    };
  });
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
  if (value === undefined || value === null) return null;
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
