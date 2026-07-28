export type FocusSessionStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";
export type FocusSessionKind = "FOCUS" | "BREAK";

export type FocusSessionRecord = {
  id: string;
  kind: FocusSessionKind;
  plannedMinutes: number;
  actualMinutes: number;
  label: string;
  startedAt: string;
  pausedAt: string | null;
  accumulatedPauseSeconds: number;
  status: FocusSessionStatus;
  completedAt: string | null;
  needsEnrichment: boolean;
  enrichedAt: string | null;
  completionNote: string | null;
  completionCategory: string | null;
  taskId: string | null;
  projectId: string | null;
  task: {
    id: string;
    title: string;
    projectId: string | null;
    project: { id: string; name: string } | null;
    phase: { id: string; name: string } | null;
  } | null;
  project: { id: string; name: string } | null;
};

export type FocusTodayStats = {
  completedSessions: number;
  focusedMinutes: number;
};

export type FocusSnapshot = {
  active: FocusSessionRecord | null;
  pendingCompletion: FocusSessionRecord | null;
  today: FocusTodayStats;
};

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

function isFocusProjectReference(
  value: unknown
): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const project = value as { id?: unknown; name?: unknown };
  return typeof project.id === "string" && typeof project.name === "string";
}

function isFocusTaskReference(
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

export function focusElapsedSeconds(session: FocusSessionRecord, now = Date.now()) {
  const end =
    session.status === "PAUSED" && session.pausedAt
      ? new Date(session.pausedAt).getTime()
      : now;
  const total = Math.floor((end - new Date(session.startedAt).getTime()) / 1000);
  return Math.max(0, total - session.accumulatedPauseSeconds);
}

export function focusRemainingSeconds(session: FocusSessionRecord, now = Date.now()) {
  return Math.max(0, session.plannedMinutes * 60 - focusElapsedSeconds(session, now));
}

export function formatFocusClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function suggestedBreakMinutes(focusMinutes: number) {
  if (focusMinutes >= 50) return 10;
  if (focusMinutes >= 25) return 5;
  return Math.max(2, Math.round(focusMinutes / 5));
}
