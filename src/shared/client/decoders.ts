"use client";

import type { ActivityEntry } from "@/components/activity-records";
import { addDays, localDateKey } from "@/lib/dates";
import { parseReviewPeriod, ReviewMutationRequestError } from "@/lib/review-domain";
import type { JournalMaterialRecord, JournalNoteRecord } from "@/lib/journal-records";
import type {
  ProjectDetail,
  ProjectDurationUnit,
  ProjectPhaseRecord,
  ProjectStatus,
  ProjectSummary,
  ProjectTaskRecord
} from "@/lib/project-domain";
import type { Diary } from "@/modules/journal/ui/journal-model";
import { isTimeBlockRecord, type TimeBlockRecord } from "@/lib/time-blocks";

type Note = JournalNoteRecord;
type Material = JournalMaterialRecord;
type TimeBlock = TimeBlockRecord;

export type PaletteTaskRecord = Pick<
  Task,
  | "id"
  | "title"
  | "date"
  | "estimateMinutes"
  | "sortOrder"
  | "focusQueuePosition"
  | "projectId"
>;

export type Review = {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  nextPeriodIntention: string;
  persisted: boolean;
};

export type DayStat = {
  day: string;
  completed: number;
  total: number;
  completionRate: number;
  plannedHours: number;
  actualHours: number;
  mood: number | null;
  energy: number | null;
};

export type ReviewSummary = {
  recordedMinutes: number;
  focusedMinutes: number;
  categoryMinutes: Array<{
    category: string;
    minutes: number;
  }>;
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

export type Bootstrap = {
  today: string;
  todayKey: string;
  earliestDayKey: string;
  dayViewForwardWeeks: number;
  workspaceEmpty: boolean;
  tasks: Task[];
  paletteTasks: PaletteTaskRecord[];
  notes: Note[];
  diary: Diary;
  materials: Material[];
  timeBlocks: TimeBlock[];
  activities: ActivityEntry[];
  activityCategorySuggestions: string[];
  projects: ProjectSummary[];
  unfinishedTasks: Task[];
  stats: DayStat[];
  review: Review;
  reviewSummary: ReviewSummary;
};

export function isPersistedReviewResponse(value: unknown): value is Review & {
  id: string;
  persisted: true;
} {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<Review>;
  return (
    typeof review.id === "string" &&
    typeof review.periodStart === "string" &&
    typeof review.periodEnd === "string" &&
    typeof review.narrative === "string" &&
    typeof review.nextPeriodIntention === "string" &&
    review.persisted === true
  );
}

export function isActivityResponse(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<ActivityEntry>;
  return (
    typeof activity.id === "string" &&
    typeof activity.startedAt === "string" &&
    Number.isInteger(activity.durationMinutes) &&
    typeof activity.category === "string" &&
    typeof activity.note === "string" &&
    (activity.origin === "MANUAL" || activity.origin === "FOCUS") &&
    (activity.taskId === null || typeof activity.taskId === "string") &&
    (activity.projectId === null || typeof activity.projectId === "string") &&
    (activity.attributedProjectId === null ||
      typeof activity.attributedProjectId === "string") &&
    (activity.focusSessionId === null ||
      typeof activity.focusSessionId === "string") &&
    typeof activity.createdAt === "string" &&
    Number.isFinite(Date.parse(activity.createdAt)) &&
    typeof activity.updatedAt === "string" &&
    Number.isFinite(Date.parse(activity.updatedAt))
  );
}

export type ProjectPatch = Partial<{
  name: string;
  desiredOutcome: string;
  targetDate: string | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  confirm: boolean;
}>;

export function isProjectDetailResponse(value: unknown): value is ProjectDetail {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<ProjectDetail>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.desiredOutcome === "string" &&
    ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(
      String(project.status)
    ) &&
    Number.isInteger(project.completedTaskCount) &&
    Number.isInteger(project.taskCount) &&
    Number.isInteger(project.phaseCount) &&
    Number.isInteger(project.backlogCount) &&
    Number.isInteger(project.investedMinutes) &&
    Number.isInteger(project.reviewPeriodInvestedMinutes) &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    Array.isArray(project.phases) &&
    Array.isArray(project.tasks) &&
    Array.isArray(project.activities) &&
    Array.isArray(project.notes) &&
    Array.isArray(project.materials)
  );
}

export function isProjectPhaseResponse(value: unknown): value is ProjectPhaseRecord {
  if (!value || typeof value !== "object") return false;
  const phase = value as Partial<ProjectPhaseRecord>;
  return (
    typeof phase.id === "string" &&
    typeof phase.projectId === "string" &&
    typeof phase.name === "string" &&
    Number.isInteger(phase.sortOrder) &&
    typeof phase.createdAt === "string" &&
    typeof phase.updatedAt === "string"
  );
}

export function isProjectTaskResponse(value: unknown): value is ProjectTaskRecord {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ProjectTaskRecord>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

export function isOkResponse(value: unknown): value is { ok: true } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true
  );
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

export type CurrentReviewWindow = Omit<ReviewWindowDetail, "review"> & { review: Review };

export function isCurrentReviewWindow(value: unknown): value is CurrentReviewWindow {
  if (!value || typeof value !== "object") return false;
  const detail = value as CurrentReviewWindow;
  // Reuse the evidence/bounds contract without widening historical review:null.
  if (!isReviewWindowDetail({ ...detail, review: null })) return false;
  try {
    const { periodEnd } = parseReviewPeriod(detail);
    if (detail.ending !== localDateKey(addDays(periodEnd, -1))) return false;
  } catch (error) {
    if (error instanceof ReviewMutationRequestError) return false;
    throw error;
  }
  const review = detail.review;
  if (!review || review.periodStart !== detail.periodStart || review.periodEnd !== detail.periodEnd) return false;
  return isPersistedReviewResponse(review) || (
    review.id === null && review.persisted === false &&
    review.narrative === "" && review.nextPeriodIntention === ""
  );
}

export type ViewedDayKind = "past" | "today" | "future";

export type ViewedDayTask = Task;

export type ViewedDayActivity = ActivityEntry;

export type ViewedDayPayload = {
  dateKey: string;
  kind: ViewedDayKind;
  tasks: ViewedDayTask[];
  timeBlocks: TimeBlockRecord[];
  activities: ViewedDayActivity[];
  earliestDayKey: string | null;
  forwardWeeks: number;
};

const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime());

function isTask(value: unknown): value is ViewedDayTask {
  return isTaskResponse(value) && value.id.length > 0 &&
    (value.date === null || isIsoTimestamp(value.date));
}

function isActivity(value: unknown): value is ViewedDayActivity {
  return isActivityResponse(value) && value.id.length > 0 &&
    isIsoTimestamp(value.startedAt) && value.durationMinutes >= 0;
}

export function isViewedDayPayload(value: unknown): value is ViewedDayPayload {
  if (!value || typeof value !== "object") return false;
  const day = value as Record<string, unknown>;
  return (
    isDayKey(day.dateKey) &&
    (day.kind === "past" || day.kind === "today" || day.kind === "future") &&
    Array.isArray(day.tasks) &&
    day.tasks.every(isTask) &&
    Array.isArray(day.timeBlocks) &&
    day.timeBlocks.every(isTimeBlockRecord) &&
    Array.isArray(day.activities) &&
    day.activities.every(isActivity) &&
    // A future day must never carry Activity, whatever the server sent. The
    // client refuses to render invented evidence rather than trusting the
    // route to have excluded it.
    (day.kind !== "future" || day.activities.length === 0) &&
    (day.earliestDayKey === null || isDayKey(day.earliestDayKey)) &&
    Number.isInteger(day.forwardWeeks) &&
    Number(day.forwardWeeks) > 0
  );
}

export function isBootstrapResponse(value: unknown): value is Bootstrap {
  const result = value as Partial<Bootstrap> | null;
  return !(!result ||
      typeof result !== "object" ||
      typeof result.workspaceEmpty !== "boolean" ||
      !Array.isArray(result.tasks) ||
      typeof result.todayKey !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.todayKey) ||
      !Array.isArray(result.timeBlocks) ||
      !result.timeBlocks.every(isTimeBlockRecord) ||
      !Array.isArray(result.activities) ||
      !result.activities.every(isActivityResponse) ||
      !Array.isArray(result.activityCategorySuggestions) ||
      !result.activityCategorySuggestions.every(
        (category: unknown) => typeof category === "string"
      ));
}

/** The collapsed Project drawer has always validated only the task array. */
export function isProjectPlanResponse(value: unknown): value is { tasks: ProjectTaskRecord[]; phases?: unknown } {
  const result = value as { tasks?: unknown } | null;
  return Boolean(result && Array.isArray(result.tasks));
}

/** Project detail reads historically accept any parsed JSON. Keep that contract. */
export function isLegacyProjectDetail(_value: unknown): _value is ProjectDetail {
  return true;
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

type Priority = "LOW" | "MEDIUM" | "HIGH";

export type Task = {
  id: string;
  title: string;
  date: string | null;
  status: TaskStatus;
  priority: Priority;
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  focusQueuePosition: number | null;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

export function isTaskResponse(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.focusQueuePosition === null ||
      Number.isInteger(task.focusQueuePosition)) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

export function isFocusQueueResponse(
  value: unknown
): value is { tasks: Task[] } {
  if (!value || typeof value !== "object") return false;
  const result = value as { tasks?: unknown };
  return Array.isArray(result.tasks) && result.tasks.every(isTaskResponse);
}
