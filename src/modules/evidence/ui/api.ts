import {
  formatTimeInput,
  type ActivityEditor,
  type ActivityEntry
} from "@/components/activity-records";
import { localDateKey, parseLocalDate } from "@/lib/dates";
import { request } from "@/shared/client/api-client";
import {
  isActivityResponse,
  isCheckInResponse,
  isHabitResponse,
  type CheckInRecord,
  type HabitRecord
} from "@/shared/client/decoders";

import type { HabitCadenceValue } from "@/modules/evidence/domain/habit";

export function createHabit(
  input: { name: string; cadence?: HabitCadenceValue; targetPerWeek?: number } | string,
  mutationId: string | null
) {
  const payload = typeof input === "string" ? { name: input } : input;
  const name = payload.name.trim();
  return request("/api/habits", {
    method: "POST",
    body: payload,
    mutationId,
    decode: (result): result is HabitRecord =>
      isHabitResponse(result) && result.name === name && result.status === "ACTIVE",
    fallback: "Habit could not be saved. Your draft is still here."
  });
}

export function renameHabit(
  habitId: string,
  name: string,
  mutationId: string | null
) {
  return request(`/api/habits/${encodeURIComponent(habitId)}`, {
    method: "PATCH",
    body: { name },
    mutationId,
    decode: (result): result is HabitRecord =>
      isHabitResponse(result) &&
      result.id === habitId &&
      result.name === name.trim() &&
      result.status === "ACTIVE",
    fallback: "Habit could not be renamed."
  });
}

export function archiveHabit(
  habitId: string,
  mutationId: string | null
) {
  return request(`/api/habits/${encodeURIComponent(habitId)}/archive`, {
    method: "POST",
    mutationId,
    decode: (result): result is HabitRecord =>
      isHabitResponse(result) &&
      result.id === habitId &&
      result.status === "ARCHIVED",
    fallback: "Habit could not be archived."
  });
}

/**
 * Check-in writes follow CHECK_INS_V1's mutation-ID convention. Passing a stable
 * mutation id allows uncertain network retries to be replayed idempotently
 * and detected if reused across differing operations.
 */
export function recordCheckIn(
  habitId: string,
  body: { date: string; done: boolean; amount?: number | null; note?: string | null },
  mutationId: string | null
) {
  const parsed = parseLocalDate(body.date);
  const expectedDate = parsed ? localDateKey(parsed) : body.date.slice(0, 10);
  return request(`/api/habits/${encodeURIComponent(habitId)}/check-in`, {
    method: "PUT",
    body,
    mutationId,
    decode: (result): result is CheckInRecord =>
      isCheckInResponse(result) &&
      result.habitId === habitId &&
      result.done === body.done &&
      localDateKey(new Date(result.date)) === expectedDate &&
      (body.amount === undefined || result.amount === body.amount) &&
      (body.note === undefined || result.note === body.note),
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
