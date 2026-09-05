import type { FocusSessionRecord, FocusSnapshot } from "@/lib/focus-domain";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { FocusStartAttempt } from "@/lib/focus-start-idempotency";
import { isFocusQueueResponse, type Task } from "@/shared/client/decoders";
import { request } from "@/shared/client/api-client";
import {
  isFocusSnapshot,
  isFocusStartResponse,
  isTransitionResult,
  type TransitionResult
} from "./focus-model";

export function queueTask(task: Pick<Task, "id">, placement: QueuePlacement) {
  return request("/api/focus-queue", {
    method: "POST",
    body: { taskId: task.id, placement },
    decode: (result): result is {
      tasks: Task[];
    } => isFocusQueueResponse(result) &&
      result.tasks.some((queuedTask) => queuedTask.id === task.id &&
        queuedTask.focusQueuePosition !== null),
    fallback: "The queue could not be saved.",
  });
}

export function removeQueuedTask(task: Pick<Task, "id">) {
  return request("/api/focus-queue", {
    method: "DELETE",
    body: { taskId: task.id },
    decode: (result): result is {
      tasks: Task[];
    } => isFocusQueueResponse(result) &&
      !result.tasks.some((queuedTask) => queuedTask.id === task.id),
    fallback: "The queue could not be saved.",
  });
}

export function reorderQueue(ids: string[], previous: Task[]) {
  return request("/api/focus-queue", {
    method: "PATCH",
    body: {
      ids,
      expectedIds: previous.map((task) => task.id)
    },
    decode: (result): result is {
      tasks: Task[];
    } => isFocusQueueResponse(result) &&
      !result.tasks.some((task, index) => task.id !== ids[index]) &&
      result.tasks.length === ids.length,
    fallback: "The queue could not be saved.",
  });
}

export function loadFocus(signal: AbortSignal) {
  return request("/api/focus-session", {
    cache: "no-store",
    signal: signal,
    decode: (result): result is FocusSnapshot => isFocusSnapshot(result),
    fallback: "Focus timer could not be loaded.",
  });
}

export function transitionFocus(id: string, action: "pause" | "resume" | "complete" | "cancel") {
  return request(`/api/focus-session/${id}`, {
    method: "PATCH",
    body: { action },
    decode: (result): result is TransitionResult => isTransitionResult(result),
    fallback: "The timer could not be updated.",
  });
}

export function startFocus(attempt: FocusStartAttempt, fallback = "The timer could not be started.") {
  return request("/api/focus-session", {
    method: "POST",
    body: attempt.payload,
    mutationId: attempt.mutationId,
    decode: (result): result is {
      session: FocusSessionRecord;
      snapshot: FocusSnapshot;
    } => isFocusStartResponse(result),
    fallback: fallback,
  });
}

export function enrichFocus(id: string, input: {
  note: string;
  category: string;
  taskCompleted: boolean;
}) {
  return request(`/api/focus-session/${id}`, {
    method: "PATCH",
    body: {
      action: "enrich",
      note: input.note,
      category: input.category,
      taskCompleted: input.taskCompleted
    },
    decode: (result): result is TransitionResult => isTransitionResult(result),
    fallback: "The completion record could not be saved.",
  });
}
