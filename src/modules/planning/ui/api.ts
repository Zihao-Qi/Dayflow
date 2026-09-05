import type { TimeBlockRecord } from "@/lib/time-blocks";
import { request } from "@/shared/client/api-client";
import { isOkResponse } from "@/shared/client/decoders";
import { isTaskReorderResponse, isTaskResponse, type Task } from "./backlog-model";
import { isTimeBlockRecord } from "./time-block-model";

export function createTask(payload: {
  title: string;
  date: string | null;
  estimateMinutes: number;
}, mutationId: string) {
  return request("/api/tasks", {
    method: "POST",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is Task => isTaskResponse(result) &&
      result.title === payload.title,
    fallback: "Your task was not saved. Your draft is still here.",
  });
}

export function createFirstTask(payload: {
  title: string;
  date: string;
  estimateMinutes: number;
}, mutationId: string) {
  return request("/api/tasks", {
    method: "POST",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is Task => isTaskResponse(result) &&
      result.title === payload.title,
    fallback: "Your first task was not saved. Your draft is still here.",
  });
}

export function updateTask(id: string, patch: Partial<Task> & {
  scheduleSource?: string;
}) {
  return request(`/api/tasks/${id}`, {
    method: "PATCH",
    body: patch,
    decode: (result): result is Task => isTaskResponse(result) &&
      result.id === id,
    fallback: "Couldn’t save that change. Your text is still here — retry.",
  });
}

export function deleteTask(id: string) {
  return request(`/api/tasks/${id}`, {
    method: "DELETE",
    decode: (result): result is {
      ok: true;
    } => isOkResponse(result),
    fallback: "Task could not be deleted.",
  });
}

export function reorderTasks(reordered: Task[]) {
  return request("/api/tasks/reorder", {
    method: "POST",
    body: { ids: reordered.map((task) => task.id)
    },
    decode: (result): result is {
      ok: true;
      tasks: Task[];
    } => isTaskReorderResponse(result) &&
      result.tasks.length === reordered.length &&
      !result.tasks.some((task, index) => task.id !== reordered[index]?.id),
    fallback: "Order could not be saved.",
  });
}

export function saveTimeBlock(id: string | null, payload: {
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  taskId: string | null;
}, mutationId: string | null) {
  const creating = id === null;
  return request(creating
    ? "/api/time-blocks"
    : `/api/time-blocks/${id}`, {
    method: creating ? "POST" : "PUT",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is TimeBlockRecord => isTimeBlockRecord(result) &&
      !(!creating && result.id !== id) &&
      result.title === payload.title.trim() &&
      result.startTime === payload.startTime &&
      result.endTime === payload.endTime &&
      result.taskId === payload.taskId &&
      result.date === payload.date,
    fallback: "Time block could not be saved. Your draft is still here.",
  });
}

export function deleteTimeBlock(id: string) {
  return request(`/api/time-blocks/${id}`, {
    method: "DELETE",
    decode: (result): result is {
      ok: true;
      id: string;
    } => isOkResponse(result) &&
      "id" in result &&
      result.id === id,
    fallback: "Time block could not be deleted. Try again.",
  });
}
