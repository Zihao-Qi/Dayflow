import type { ActivityOrigin } from "@prisma/client";
import {
  addDays,
  reviewPeriodRange,
  startOfLocalDay
} from "@/lib/dates";

export const REVIEW_NARRATIVE_MAX_LENGTH = 5_000;
export const REVIEW_INTENTION_MAX_LENGTH = 1_000;

export type ReviewMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "REVIEW_PERIOD_CHANGED";

export class ReviewMutationRequestError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code: ReviewMutationErrorCode = "VALIDATION_ERROR",
    readonly status: 400 | 409 = 400
  ) {
    super(message);
    this.name = "ReviewMutationRequestError";
  }
}

export type ReviewMutation = {
  periodStart: Date;
  periodEnd: Date;
  narrative: string;
  nextPeriodIntention: string;
};

type ReviewPeriod = Pick<ReviewMutation, "periodStart" | "periodEnd">;

type ReviewActivity = {
  origin: ActivityOrigin;
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ReviewMutationRequestError(
      "Request body must be valid JSON.",
      "body",
      "INVALID_JSON"
    );
  }
  return requireObject(body);
}

export function parseReviewMutation(value: unknown): ReviewMutation {
  const body = requireObject(value);
  const periodStart = parseReviewBoundary(body.periodStart, "periodStart");
  const periodEnd = parseReviewBoundary(body.periodEnd, "periodEnd");
  if (periodEnd <= periodStart) {
    throw new ReviewMutationRequestError(
      "Review Period end must be after its start.",
      "periodEnd"
    );
  }
  if (startOfLocalDay(periodStart).getTime() !== periodStart.getTime()) {
    throw new ReviewMutationRequestError(
      "Review Period start must be local midnight.",
      "periodStart"
    );
  }
  if (startOfLocalDay(periodEnd).getTime() !== periodEnd.getTime()) {
    throw new ReviewMutationRequestError(
      "Review Period end must be local midnight.",
      "periodEnd"
    );
  }
  if (addDays(periodStart, 7).getTime() !== periodEnd.getTime()) {
    throw new ReviewMutationRequestError(
      "Review Period must span exactly seven local days.",
      "periodEnd"
    );
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
    throw new ReviewMutationRequestError(
      "Write a narrative or next-period intention before saving this Review.",
      "review"
    );
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
  now = new Date()
) {
  const current = reviewPeriodRange(now);
  if (
    period.periodStart.getTime() !== current.start.getTime() ||
    period.periodEnd.getTime() !== current.end.getTime()
  ) {
    throw new ReviewMutationRequestError(
      "The Review Period changed. Refresh and try again.",
      "reviewPeriod",
      "REVIEW_PERIOD_CHANGED",
      409
    );
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReviewMutationRequestError(
      "Request body must be a JSON object.",
      "body"
    );
  }
  return value as JsonObject;
}

function parseReviewBoundary(
  value: unknown,
  field: "periodStart" | "periodEnd"
) {
  if (typeof value !== "string" || !isCanonicalIsoInstant(value)) {
    throw new ReviewMutationRequestError(
      `Review Period ${field === "periodStart" ? "start" : "end"} must be a valid ISO timestamp.`,
      field
    );
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
  if (typeof value !== "string") {
    throw new ReviewMutationRequestError(`${label} must be text.`, field);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ReviewMutationRequestError(
      `${label} must be ${maxLength} characters or fewer.`,
      field
    );
  }
  return text;
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
