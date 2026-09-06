

/**
 * Activity shapes and helpers shared by the Dashboard and the activity-capture
 * hook. They live here rather than in `dashboard.tsx` so the hook can import
 * them without the two modules importing each other.
 */

export { type ActivityEntry, isActivityResponse } from "@/modules/evidence/domain/activity";
import type { ActivityEntry } from "@/modules/evidence/domain/activity";

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
