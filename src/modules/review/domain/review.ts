import { addDays, startOfLocalDay, calendarFor, type Calendar, type LocalDay } from "@/shared/kernel/calendar";
import { requestErrors } from "@/shared/kernel/request-errors";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import { requireObject as kernelRequireObject, parseBoundedString, readJsonBody } from "@/shared/kernel/parsing";

export const REVIEW_NARRATIVE_MAX_LENGTH = 5_000;
export const REVIEW_INTENTION_MAX_LENGTH = 1_000;

export type ReviewMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "REVIEW_PERIOD_CHANGED";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as ReviewMutationRequestError };

export type ReviewMutation = {
  periodStart: Date;
  periodEnd: Date;
  narrative: string;
  nextPeriodIntention: string;
};

type ReviewPeriod = Pick<ReviewMutation, "periodStart" | "periodEnd">;

type ReviewActivity = {
  origin: "MANUAL" | "FOCUS";
  durationMinutes: number;
  category: string;
  focusSession?: {
    needsEnrichment: boolean;
  } | null;
};

type ReviewDiary = {
  mood: number;
  energy: number;
};

export type ReviewSummaryInput = {
  activities: readonly ReviewActivity[];
  completedTasks: readonly unknown[];
  notes: readonly unknown[];
  materials: readonly unknown[];
  diaries: readonly ReviewDiary[];
};

export type ReviewSummary = {
  recordedMinutes: number;
  focusedMinutes: number;
  categoryMinutes: Array<{ category: string; minutes: number }>;
  completedTaskCount: number;
  noteCount: number;
  materialCount: number;
  diaryDayCount: number;
  averageMood: number | null;
  averageEnergy: number | null;
  pendingEnrichmentSessions: number;
  pendingEnrichmentMinutes: number;
};

type JsonObject = Record<string, unknown>;

export async function readReviewMutationBody(request: {
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

export function parseReviewMutation(value: unknown, calendar: Calendar = calendarFor(Intl.DateTimeFormat().resolvedOptions().timeZone)): ReviewMutation {
  const body = requireObject(value);
  const periodStart = parseReviewBoundary(body.periodStart, "periodStart");
  const periodEnd = parseReviewBoundary(body.periodEnd, "periodEnd");
  if (periodEnd <= periodStart) {
    throw new AppError(reviewErrors.reviewPeriodEndMustBeAfterItsStart);
  }
  // The legacy ISO parser also accepts years outside Calendar's LocalDay range.
  // Preserve their structural validation so a stale save still reaches the 409 rule.
  const legacyYear = periodStart.getFullYear() < 1000 || periodEnd.getFullYear() < 1000 || periodStart.getFullYear() >= 9999;
  const midnight = (date: Date) => legacyYear
    ? startOfLocalDay(date) : calendar.startOf(calendar.dayOf(date));
  if (midnight(periodStart).getTime() !== periodStart.getTime()) {
    throw new AppError(reviewErrors.reviewPeriodStartMustBeLocalMidnight);
  }
  if (midnight(periodEnd).getTime() !== periodEnd.getTime()) {
    throw new AppError(reviewErrors.reviewPeriodEndMustBeLocalMidnight);
  }
  const sevenDaysLater = legacyYear ? addDays(periodStart, 7)
    : calendar.startOf(calendar.addDays(calendar.dayOf(periodStart), 7));
  if (sevenDaysLater.getTime() !== periodEnd.getTime()) {
    throw new AppError(reviewErrors.reviewPeriodMustSpanExactlySevenLocalDays);
  }

  const narrative = parseReviewText(
    body.narrative,
    "narrative",
    "Review narrative",
    REVIEW_NARRATIVE_MAX_LENGTH
  );
  const nextPeriodIntention = parseReviewText(
    body.nextPeriodIntention,
    "nextPeriodIntention",
    "Next-period intention",
    REVIEW_INTENTION_MAX_LENGTH
  );
  if (!narrative && !nextPeriodIntention) {
    throw new AppError(reviewErrors.writeANarrativeOrNextperiodIntentionBeforeSavingThisReview);
  }

  return {
    periodStart,
    periodEnd,
    narrative,
    nextPeriodIntention
  };
}

export function assertCurrentReviewPeriod(
  period: ReviewPeriod,
  now: Date,
  calendar: Calendar = calendarFor(Intl.DateTimeFormat().resolvedOptions().timeZone)
) {
  const current = calendar.reviewPeriodEnding(calendar.dayOf(now));
  if (
    period.periodStart.getTime() !== current.start.getTime() ||
    period.periodEnd.getTime() !== current.end.getTime()
  ) {
    throw new AppError(reviewErrors.theReviewPeriodChangedRefreshAndTryAgain);
  }
  return current;
}

export function buildReviewSummary({
  activities,
  completedTasks,
  notes,
  materials,
  diaries
}: ReviewSummaryInput): ReviewSummary {
  const pendingEnrichment = activities.filter(
    (activity) =>
      activity.origin === "FOCUS" &&
      activity.focusSession?.needsEnrichment
  );
  const byCategory = new Map<string, number>();
  for (const activity of activities) {
    const category = activity.category.trim() || "Uncategorized";
    byCategory.set(
      category,
      (byCategory.get(category) ?? 0) + activity.durationMinutes
    );
  }

  return {
    recordedMinutes: activities.reduce(
      (total, activity) => total + activity.durationMinutes,
      0
    ),
    focusedMinutes: activities
      .filter((activity) => activity.origin === "FOCUS")
      .reduce((total, activity) => total + activity.durationMinutes, 0),
    categoryMinutes: [...byCategory]
      .map(([category, minutes]) => ({ category, minutes }))
      .sort(
        (left, right) =>
          right.minutes - left.minutes ||
          compareText(left.category, right.category)
      ),
    completedTaskCount: completedTasks.length,
    noteCount: notes.length,
    materialCount: materials.length,
    diaryDayCount: diaries.length,
    averageMood: average(diaries.map((diary) => diary.mood)),
    averageEnergy: average(diaries.map((diary) => diary.energy)),
    pendingEnrichmentSessions: pendingEnrichment.length,
    pendingEnrichmentMinutes: pendingEnrichment.reduce(
      (total, activity) => total + activity.durationMinutes,
      0
    )
  };
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseReviewBoundary(
  value: unknown,
  field: "periodStart" | "periodEnd"
) {
  if (typeof value !== "string" || !isCanonicalIsoInstant(value)) {
    throw validation(`Review Period ${field === "periodStart" ? "start" : "end"} must be a valid ISO timestamp.`, field);
  }
  return new Date(value);
}

function isCanonicalIsoInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function parseReviewText(
  value: unknown,
  field: "narrative" | "nextPeriodIntention",
  label: string,
  maxLength: number
) {
  if (value === undefined) return "";
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength: maxLength,
    lengthMessage: `${label} must be ${maxLength} characters or fewer.`,
    trim: true
  });
}

function average(values: number[]) {
  if (!values.length) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.round(mean * 10) / 10;
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function validationError(message: string, field: string) {
  return validation(message, field);
}

export type PastReviewRecord = {
  id: string;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  nextPeriodIntention: string;
};

export type ReviewHistoryPage = {
  items: PastReviewRecord[];
  nextCursor: string | null;
  totalCount: number;
};

export type PastReviewSummary = {
  recordedMinutes: number;
  focusedMinutes: number;
  categoryMinutes: Array<{ category: string; minutes: number }>;
  completedTaskCount: number;
  noteCount: number;
  materialCount: number;
  diaryDayCount: number;
  averageMood: number | null;
  averageEnergy: number | null;
  movedProjectCount: number;
  pendingEnrichmentSessions: number;
  pendingEnrichmentMinutes: number;
};

export type PastReviewProject = {
  id: string;
  name: string;
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number | null;
  reviewPeriodInvestedMinutes: number;
  movedDuringReviewPeriod: boolean;
};

export type PastReviewDetail = {
  review: PastReviewRecord;
  reviewSummary: PastReviewSummary;
  projects: PastReviewProject[];
  isCurrentPeriod: boolean;
};

export type ReviewWindowDetail = {
  ending: string;
  periodStart: string;
  periodEnd: string;
  review: PastReviewRecord | null;
  reviewSummary: PastReviewSummary;
  projects: PastReviewProject[];
};

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !Number.isNaN(new Date(value).getTime());

const isLocalDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
};

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

const isNullableRating = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

export function isPastReviewRecord(value: unknown): value is PastReviewRecord {
  if (!value || typeof value !== "object") return false;
  const review = value as Record<string, unknown>;
  return (
    typeof review.id === "string" &&
    review.id.length > 0 &&
    isIsoDate(review.periodStart) &&
    isIsoDate(review.periodEnd) &&
    new Date(review.periodStart).getTime() <
      new Date(review.periodEnd).getTime() &&
    typeof review.narrative === "string" &&
    typeof review.nextPeriodIntention === "string"
  );
}

export function isReviewHistoryPage(value: unknown): value is ReviewHistoryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    page.items.every(isPastReviewRecord) &&
    (page.nextCursor === null || typeof page.nextCursor === "string") &&
    isCount(page.totalCount)
  );
}

export function isPastReviewSummary(value: unknown): value is PastReviewSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  return (
    isCount(summary.recordedMinutes) &&
    isCount(summary.focusedMinutes) &&
    Array.isArray(summary.categoryMinutes) &&
    summary.categoryMinutes.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return typeof item.category === "string" && isCount(item.minutes);
    }) &&
    isCount(summary.completedTaskCount) &&
    isCount(summary.noteCount) &&
    isCount(summary.materialCount) &&
    isCount(summary.diaryDayCount) &&
    isNullableRating(summary.averageMood) &&
    isNullableRating(summary.averageEnergy) &&
    isCount(summary.movedProjectCount) &&
    isCount(summary.pendingEnrichmentSessions) &&
    isCount(summary.pendingEnrichmentMinutes)
  );
}

export function isPastReviewProject(
  value: unknown
): value is PastReviewProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return (
    typeof project.id === "string" &&
    project.id.length > 0 &&
    typeof project.name === "string" &&
    isCount(project.taskCount) &&
    isCount(project.completedTaskCount) &&
    (project.progressPercent === null ||
      (typeof project.progressPercent === "number" &&
        Number.isFinite(project.progressPercent))) &&
    isCount(project.reviewPeriodInvestedMinutes) &&
    typeof project.movedDuringReviewPeriod === "boolean"
  );
}

export function isPastReviewDetail(value: unknown): value is PastReviewDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Record<string, unknown>;
  return (
    isPastReviewRecord(detail.review) &&
    isPastReviewSummary(detail.reviewSummary) &&
    Array.isArray(detail.projects) &&
    detail.projects.every(isPastReviewProject) &&
    typeof detail.isCurrentPeriod === "boolean"
  );
}

export function isReviewWindowDetail(
  value: unknown
): value is ReviewWindowDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Record<string, unknown>;
  if (
    !isLocalDate(detail.ending) ||
    !isIsoDate(detail.periodStart) ||
    !isIsoDate(detail.periodEnd) ||
    new Date(detail.periodStart).getTime() >=
      new Date(detail.periodEnd).getTime() ||
    !isPastReviewSummary(detail.reviewSummary) ||
    !Array.isArray(detail.projects) ||
    !detail.projects.every(isPastReviewProject)
  ) {
    return false;
  }
  if (detail.review === null) return true;
  return (
    isPastReviewRecord(detail.review) &&
    detail.review.periodStart === detail.periodStart &&
    detail.review.periodEnd === detail.periodEnd
  );
}

export const REVIEW_HISTORY_DEFAULT_LIMIT = 20;
export const REVIEW_HISTORY_MAX_LIMIT = 100;
const REVIEW_CURSOR_MAX_LENGTH = 1_024;

export type ReviewHistoryErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CURSOR"
  | "REVIEW_NOT_FOUND";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as ReviewHistoryRequestError };

export type ReviewPeriodInterval = {
  start: Date;
  end: Date;
};

export type ReviewCursor = {
  periodStart: Date;
  id: string;
};

export type ReviewWindowRequest = ReviewPeriodInterval & {
  ending: string;
};


export function parseReviewWindowRequest(
  searchParams: URLSearchParams,
  now: Date,
  calendar: Calendar = calendarFor(Intl.DateTimeFormat().resolvedOptions().timeZone)
): ReviewWindowRequest {
  const values = searchParams.getAll("ending");
  if (values.length !== 1) {
    throw new AppError(values.length ? reviewErrors.multipleWindowEndingDays : reviewErrors.windowEndingDayRequired);
  }

  const ending = values[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ending)) {
    throw new AppError(reviewErrors.aReviewWindowEndingDayMustBeACalendarDateSuch);
  }

  let endingDay: Date | null = null;
  try { endingDay = calendar.startOf(ending as LocalDay); } catch { /* Invalid civil date. */ }
  if (!endingDay || calendar.dayOf(endingDay) !== ending) {
    throw new AppError(reviewErrors.thatReviewWindowEndingDayIsNotARealCalendarDate);
  }
  if (endingDay.getTime() >= calendar.startOf(calendar.dayOf(now)).getTime()) {
    throw new AppError(reviewErrors.reviewWindowsMustEndBeforeToday);
  }

  return {
    ending,
    ...calendar.reviewPeriodEnding(ending as LocalDay)
  };
}

export function parseCurrentReviewWindowRequest(searchParams: URLSearchParams, now: Date,
  calendar: Calendar = calendarFor(Intl.DateTimeFormat().resolvedOptions().timeZone)
): ReviewWindowRequest {
  const values = searchParams.getAll("current");
  if (values.length !== 1 || values[0] !== "1" || searchParams.has("ending")) {
    throw new AppError(reviewErrors.currentWindowModeRequired);
  }
  const period = calendar.reviewPeriodEnding(calendar.dayOf(now));
  return { ending: calendar.addDays(calendar.dayOf(period.end), -1), ...period };
}

export function parseReviewHistoryPage(searchParams: URLSearchParams) {
  const limitValues = searchParams.getAll("limit");
  if (limitValues.length > 1) {
    throw new AppError(reviewErrors.provideOnlyOnePageLimit);
  }

  let limit = REVIEW_HISTORY_DEFAULT_LIMIT;
  if (limitValues.length === 1) {
    const raw = limitValues[0].trim();
    const parsed = Number(raw);
    if (
      !raw ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > REVIEW_HISTORY_MAX_LIMIT
    ) {
      throw new AppError(reviewErrors.pageLimitMustBeAWholeNumberBetween1And100);
    }
    limit = parsed;
  }

  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    throw new AppError(reviewErrors.provideOnlyOnePaginationCursor);
  }

  return {
    limit,
    cursor: cursorValues.length === 1 ? decodeReviewCursor(cursorValues[0]) : null
  };
}

export function encodeReviewCursor(value: ReviewCursor) {
  return encodeCursorText(
    JSON.stringify({
      version: 1,
      kind: "review",
      periodStart: value.periodStart.toISOString(),
      id: value.id
    })
  );
}

export function decodeReviewCursor(value: string): ReviewCursor {
  try {
    if (
      !value.length ||
      value.length > REVIEW_CURSOR_MAX_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new Error("malformed cursor");
    }
    const decoded = JSON.parse(
      decodeCursorText(value)
    ) as Record<string, unknown>;
    if (
      decoded.version !== 1 ||
      decoded.kind !== "review" ||
      typeof decoded.periodStart !== "string" ||
      typeof decoded.id !== "string" ||
      !decoded.id
    ) {
      throw new Error("unsupported cursor");
    }
    const periodStart = new Date(decoded.periodStart);
    if (Number.isNaN(periodStart.getTime())) {
      throw new Error("invalid cursor period");
    }
    return { periodStart, id: decoded.id };
  } catch {
    throw new AppError(reviewErrors.thatPaginationCursorIsNoLongerUsableReloadReviewHistory);
  }
}

export function isReviewIdentifier(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function encodeCursorText(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursorText(text: string) {
  // Match Buffer's legacy decoder: discard a lone trailing sextet and retain
  // a leading BOM so JSON.parse rejects it rather than silently accepting it.
  const complete = text.length % 4 === 1 ? text.slice(0, -1) : text;
  const bytes = atob(complete.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    Uint8Array.from(bytes, character => character.charCodeAt(0))
  );
}


/** Exact envelopes owned by the review boundary. The serializer emits exactly the declared properties. */
export const reviewErrors = {
  currentWindowModeRequired: {
    status: 400,
    message: "Use current=1 without a Review Window ending day.",
    code: "VALIDATION_ERROR"
  },
  reviewPeriodEndMustBeAfterItsStart: {
    status: 400,
    message: "Review Period end must be after its start.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  reviewPeriodStartMustBeLocalMidnight: {
    status: 400,
    message: "Review Period start must be local midnight.",
    code: "VALIDATION_ERROR",
    field: "periodStart"
  },
  reviewPeriodEndMustBeLocalMidnight: {
    status: 400,
    message: "Review Period end must be local midnight.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  reviewPeriodMustSpanExactlySevenLocalDays: {
    status: 400,
    message: "Review Period must span exactly seven local days.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  writeANarrativeOrNextperiodIntentionBeforeSavingThisReview: {
    status: 400,
    message: "Write a narrative or next-period intention before saving this Review.",
    code: "VALIDATION_ERROR",
    field: "review"
  },
  theReviewPeriodChangedRefreshAndTryAgain: {
    status: 409,
    message: "The Review Period changed. Refresh and try again.",
    code: "REVIEW_PERIOD_CHANGED",
    field: "reviewPeriod"
  },
  aReviewWindowEndingDayMustBeACalendarDateSuch: {
    status: 400,
    message: "A Review Window ending day must be a calendar date such as 2026-08-31.",
    code: "VALIDATION_ERROR"
  },
  thatReviewWindowEndingDayIsNotARealCalendarDate: {
    status: 400,
    message: "That Review Window ending day is not a real calendar date.",
    code: "VALIDATION_ERROR"
  },
  reviewWindowsMustEndBeforeToday: {
    status: 400,
    message: "Review Windows must end before today.",
    code: "VALIDATION_ERROR"
  },
  provideOnlyOnePageLimit: {
    status: 400,
    message: "Provide only one page limit.",
    code: "VALIDATION_ERROR"
  },
  pageLimitMustBeAWholeNumberBetween1And100: {
    status: 400,
    message: "Page limit must be a whole number between 1 and 100.",
    code: "VALIDATION_ERROR"
  },
  provideOnlyOnePaginationCursor: {
    status: 400,
    message: "Provide only one pagination cursor.",
    code: "INVALID_CURSOR"
  },
  thatPaginationCursorIsNoLongerUsableReloadReviewHistory: {
    status: 400,
    message: "That pagination cursor is no longer usable. Reload Review history.",
    code: "INVALID_CURSOR"
  },
  thatReviewIdentifierIsNotValid: {
    status: 400,
    message: "That Review identifier is not valid.",
    code: "VALIDATION_ERROR"
  },
  thatReviewNoLongerExists: {
    status: 404,
    message: "That Review no longer exists.",
    code: "REVIEW_NOT_FOUND"
  },
  reviewPeriodCouldNotBeRead: {
    status: 500,
    message: "Review period could not be read.",
    code: "INTERNAL_ERROR"
  },
  reviewHistoryCouldNotBeRead: {
    status: 500,
    message: "Review history could not be read.",
    code: "INTERNAL_ERROR"
  },
  reviewCouldNotBeSaved: {
    status: 500,
    message: "Review could not be saved.",
    code: "INTERNAL_ERROR"
  },
  reviewWindowCouldNotBeRead: {
    status: 500,
    message: "Review Window could not be read.",
    code: "INTERNAL_ERROR"
  },
  multipleWindowEndingDays: {
    status: 400,
    message: "Provide only one Review Window ending day.",
    code: "VALIDATION_ERROR"
  },
  windowEndingDayRequired: {
    status: 400,
    message: "Choose a Review Window ending day.",
    code: "VALIDATION_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
