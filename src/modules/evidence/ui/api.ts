import {
  formatTimeInput,
  type ActivityEditor,
  type ActivityEntry
} from "@/components/activity-records";
import { localDateKey } from "@/lib/dates";
import { request } from "@/shared/client/api-client";
import {
  isActivityResponse,
  isCheckInResponse,
  isHabitResponse,
  type CheckInRecord,
  type HabitRecord
} from "@/shared/client/decoders";

export function createHabit(name: string, mutationId: string | null) {
  return request("/api/habits", {
    method: "POST",
    body: { name },
    mutationId,
    decode: (result): result is HabitRecord =>
      isHabitResponse(result) && result.name === name && result.status === "ACTIVE",
    fallback: "Habit could not be saved. Your draft is still here."
  });
}

/**
 * Recording is an upsert keyed by Habit and day, so a repeated request lands on
 * the same row and the mutation id is optional. Callers that want a lost
 * response replayed verbatim may still pass one.
 */
export function recordCheckIn(
  habitId: string,
  body: { date: string; done: boolean },
  mutationId: string | null
) {
  return request(`/api/habits/${encodeURIComponent(habitId)}/check-in`, {
    method: "PUT",
    body,
    mutationId,
    decode: (result): result is CheckInRecord =>
      isCheckInResponse(result) &&
      result.habitId === habitId &&
      result.done === body.done,
    fallback: "Check-in could not be saved."
  });
}

export function saveActivity(activeEditor: ActivityEditor | null, editable: {
  startTime: string;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
}, payload: typeof editable & {
  date?: string;
}, selectedDate: string, expectedAttributedProjectId: string | null, mutationId: string | null) {
  const expectedDate = activeEditor
    ? localDateKey(new Date(activeEditor.original.startedAt))
    : selectedDate;
  return request(activeEditor
    ? `/api/activities/${encodeURIComponent(activeEditor.original.id)}`
    : "/api/activities", {
    method: activeEditor ? "PUT" : "POST",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is ActivityEntry => isActivityResponse(result) &&
      !(activeEditor && result.id !== activeEditor.original.id) &&
      !(activeEditor && result.createdAt !== activeEditor.original.createdAt) &&
      !(activeEditor &&
        Date.parse(result.updatedAt) <=
          Date.parse(activeEditor.original.updatedAt)) &&
      result.origin === "MANUAL" &&
      result.focusSessionId === null &&
      localDateKey(new Date(result.startedAt)) === expectedDate &&
      formatTimeInput(new Date(result.startedAt)) === editable.startTime &&
      result.note === payload.note &&
      result.durationMinutes === payload.durationMinutes &&
      result.category === payload.category &&
      result.taskId === editable.taskId &&
      result.projectId === editable.projectId &&
      result.attributedProjectId === expectedAttributedProjectId,
    fallback: activeEditor ? "Activity could not be updated. Your draft is still here." : "Activity could not be saved. Your draft is still here.",
  });
}
