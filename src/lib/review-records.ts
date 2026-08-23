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

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !Number.isNaN(new Date(value).getTime());

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
