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

export function focusElapsedSeconds(session: FocusSessionRecord, now: number) {
  const end =
    session.status === "PAUSED" && session.pausedAt
      ? new Date(session.pausedAt).getTime()
      : now;
  const total = Math.floor((end - new Date(session.startedAt).getTime()) / 1000);
  return Math.max(0, total - session.accumulatedPauseSeconds);
}

export function focusRemainingSeconds(session: FocusSessionRecord, now: number) {
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

/**
 * The focus duration every entry point proposes before the user chooses one.
 * The Focus Rail, the sidebar button, the ⌘⇧F shortcut, and the Capture
 * palette must all open on the same number.
 */
export const DEFAULT_FOCUS_MINUTES = 25;

export { isFocusSessionRecord,isFocusSnapshot,isFocusStartResponse } from "@/modules/focus/ui/focus-model";
