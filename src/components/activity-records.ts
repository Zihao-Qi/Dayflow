

/**
 * Activity shapes and helpers shared by the Dashboard and the activity-capture
 * hook. They live here rather than in `dashboard.tsx` so the hook can import
 * them without the two modules importing each other.
 */

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

export function formatTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;
}
