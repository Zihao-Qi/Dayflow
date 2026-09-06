import { parseLocalDate, startOfLocalDay } from "@/shared/kernel/calendar";
import { requestErrors } from "@/shared/kernel/request-errors";
import { validation } from "@/shared/kernel/errors";
import { requireObject as kernelRequireObject, parseNullableLocalDate, parseBoundedString, parseBoundedInteger as kernelParseBoundedInteger } from "@/shared/kernel/parsing";
import { evidenceErrors } from "./activity";

export const DIARY_CONTENT_MAX_LENGTH = 20_000;
export const DIARY_REFLECTION_MAX_LENGTH = 5_000;
type JsonObject = Record<string, unknown>;

export type DiaryUpsertMutation = {
  date: Date;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
};

export function parseDiaryUpsertMutation(
  value: unknown,
  now: Date
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

export type Diary = {
  id: string | null;
  date: string;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
  persisted: boolean;
};

export function isPersistedDiaryResponse(value: unknown): value is Diary & {
  id: string;
  persisted: true;
} {
  if (!value || typeof value !== "object") return false;
  const diary = value as Partial<Diary>;
  return (
    typeof diary.id === "string" &&
    typeof diary.date === "string" &&
    typeof diary.content === "string" &&
    typeof diary.reflection === "string" &&
    Number.isInteger(diary.mood) &&
    Number.isInteger(diary.energy) &&
    diary.persisted === true
  );
}

