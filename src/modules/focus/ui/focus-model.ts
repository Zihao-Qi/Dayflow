import type { FocusSessionRecord, FocusSnapshot, FocusTodayStats } from "@/lib/focus-domain";
import type { FocusDraft } from "@/lib/focus-draft";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { ProjectSummary } from "@/lib/project-domain";

export type { FocusDraft } from "@/lib/focus-draft";

export type FocusTask = {
  id: string;
  title: string;
  projectId: string | null;
  date: string | null;
  estimateMinutes?: number;
  sortOrder?: number;
  focusQueuePosition?: number | null;
};

export type CapturedActivity = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
};

export type FocusRailProps = {
  tasks: FocusTask[];
  projects: ProjectSummary[];
  today: string;
  draft: FocusDraft | null;
  activities: CapturedActivity[];
  queuedTasks?: FocusTask[];
  mode: "full" | "strip";
  collapsible?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onOpenPalette?: () => void;
  onQueueTask?: (taskId: string, placement: QueuePlacement) => Promise<boolean>;
  onRemoveQueuedTask?: (taskId: string) => Promise<boolean>;
  onReorderQueue?: (ids: string[], announcement: string) => Promise<boolean>;
  onQueueChanged?: () => Promise<void>;
  onAnnounce?: (message: string) => void;
};

export type FocusQueueEntry =
  | {
      id: "__focus_break__";
      kind: "break";
      title: "Break — stand up";
      durationMinutes: number;
    }
  | {
      id: string;
      kind: "task";
      title: string;
      durationMinutes: number;
      task: FocusTask;
    };

export type TransitionResult = {
  completed: boolean;
  suggestedBreakMinutes: number | null;
  completedSession?: FocusSessionRecord | null;
  snapshot: FocusSnapshot;
  error?: string;
};

export function isTransitionResult(value: unknown): value is TransitionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<TransitionResult>;
  return (
    typeof result.completed === "boolean" &&
    (result.suggestedBreakMinutes === null ||
      (Number.isInteger(result.suggestedBreakMinutes) &&
        Number(result.suggestedBreakMinutes) >= 0)) &&
    (result.completedSession === undefined ||
      result.completedSession === null ||
      isFocusSessionRecord(result.completedSession)) &&
    isFocusSnapshot(result.snapshot)
  );
}

export function isFocusSessionRecord(
  value: unknown
): value is FocusSessionRecord {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<FocusSessionRecord>;
  return (
    typeof session.id === "string" &&
    ["FOCUS", "BREAK"].includes(String(session.kind)) &&
    Number.isInteger(session.plannedMinutes) &&
    Number(session.plannedMinutes) >= 1 &&
    Number.isInteger(session.actualMinutes) &&
    Number(session.actualMinutes) >= 0 &&
    typeof session.label === "string" &&
    typeof session.startedAt === "string" &&
    (session.pausedAt === null || typeof session.pausedAt === "string") &&
    Number.isInteger(session.accumulatedPauseSeconds) &&
    Number(session.accumulatedPauseSeconds) >= 0 &&
    ["RUNNING", "PAUSED", "COMPLETED", "CANCELED"].includes(
      String(session.status)
    ) &&
    (session.completedAt === null ||
      typeof session.completedAt === "string") &&
    typeof session.needsEnrichment === "boolean" &&
    (session.enrichedAt === null || typeof session.enrichedAt === "string") &&
    (session.completionNote === null ||
      typeof session.completionNote === "string") &&
    (session.completionCategory === null ||
      typeof session.completionCategory === "string") &&
    (session.taskId === null || typeof session.taskId === "string") &&
    (session.projectId === null || typeof session.projectId === "string") &&
    isFocusTaskReference(session.task) &&
    isFocusProjectReference(session.project)
  );
}

export function isFocusSnapshot(value: unknown): value is FocusSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FocusSnapshot>;
  if (!snapshot.today || typeof snapshot.today !== "object") return false;
  const today = snapshot.today as Partial<FocusTodayStats>;
  return (
    (snapshot.active === null || isFocusSessionRecord(snapshot.active)) &&
    (snapshot.pendingCompletion === null ||
      isFocusSessionRecord(snapshot.pendingCompletion)) &&
    Number.isInteger(today.completedSessions) &&
    Number(today.completedSessions) >= 0 &&
    Number.isInteger(today.focusedMinutes) &&
    Number(today.focusedMinutes) >= 0
  );
}

export function isFocusStartResponse(
  value: unknown
): value is { session: FocusSessionRecord; snapshot: FocusSnapshot } {
  if (!value || typeof value !== "object") return false;
  const result = value as {
    session?: unknown;
    snapshot?: unknown;
  };
  return (
    isFocusSessionRecord(result.session) &&
    result.session.status === "RUNNING" &&
    isFocusSnapshot(result.snapshot) &&
    result.snapshot.active?.id === result.session.id
  );
}

export function isFocusProjectReference(
  value: unknown
): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const project = value as { id?: unknown; name?: unknown };
  return typeof project.id === "string" && typeof project.name === "string";
}

export function isFocusTaskReference(
  value: unknown
): value is FocusSessionRecord["task"] {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const task = value as {
    id?: unknown;
    title?: unknown;
    projectId?: unknown;
    project?: unknown;
    phase?: unknown;
  };
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.projectId === null || typeof task.projectId === "string") &&
    isFocusProjectReference(task.project) &&
    isFocusProjectReference(task.phase)
  );
}
