import type { MutableRefObject } from "react";

/**
 * Activity shapes and helpers shared by the Dashboard and the activity-capture
 * hook. They live here rather than in `dashboard.tsx` so the hook can import
 * them without the two modules importing each other.
 */

export type PendingMutation = { id: string; fingerprint: string };

export type ActivityEntry = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  origin: "MANUAL" | "FOCUS";
  taskId: string | null;
  projectId: string | null;
  attributedProjectId: string | null;
  focusSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityDraft = {
  date: string;
  time: string;
  duration: string;
  category: string;
  taskId: string;
  projectId: string;
  note: string;
};

export type ActivityEditor = {
  original: ActivityEntry;
  draft: ActivityDraft;
};

export type ActivityTaskOption = {
  id: string;
  title: string;
  projectId: string | null;
};

export function isActivityResponse(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<ActivityEntry>;
  return (
    typeof activity.id === "string" &&
    typeof activity.startedAt === "string" &&
    Number.isInteger(activity.durationMinutes) &&
    typeof activity.category === "string" &&
    typeof activity.note === "string" &&
    ["MANUAL", "FOCUS"].includes(String(activity.origin)) &&
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

/**
 * A stable mutation id per distinct payload, so a retry of the same create is
 * recognised by the server as a replay rather than a second record.
 */
export function mutationIdFor(
  reference: MutableRefObject<PendingMutation | null>,
  payload: unknown
) {
  const fingerprint = JSON.stringify(payload);
  if (reference.current?.fingerprint === fingerprint) {
    return reference.current.id;
  }
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `dayflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reference.current = { id, fingerprint };
  return id;
}

export function formatTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;
}
