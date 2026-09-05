"use client";

import type { QueuePlacement } from "@/lib/focus-queue";
import {
  queueTask as queueTaskRequest,
  removeQueuedTask as removeQueuedTaskRequest,
  reorderQueue as reorderQueueRequest
} from "@/modules/focus/ui/api";
import { type Task } from "@/modules/planning/ui";

import { type ShellState } from "./use-shell-state";

export function useQueueActions({
  setData,
  setAppAnnouncement,
  setAppError,
  queuedTasks,
  refresh,
  refreshAfterConfirmedMutation
}: Pick<
  ShellState,
  | "setData"
  | "setAppAnnouncement"
  | "setAppError"
> & {
  queuedTasks: Task[];
  refresh: () => Promise<void>;
  refreshAfterConfirmedMutation: () => Promise<boolean>;
}) {
  async function queueTask(
    task: Pick<Task, "id" | "title">,
    placement: QueuePlacement
  ) {
    try {
      const result = await queueTaskRequest(task, placement);

      setAppError("");
      setAppAnnouncement(
        placement === "next"
          ? `${task.title}, queued next.`
          : `${task.title}, added to the queue.`
      );
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Couldn’t save the focus queue. Try that action again.");
      setAppAnnouncement("The focus queue was not saved.");
      return false;
    }
  }

  async function removeQueuedTask(task: Pick<Task, "id" | "title">) {
    try {
      const result = await removeQueuedTaskRequest(task);

      setAppError("");
      setAppAnnouncement(`${task.title}, removed from the queue.`);
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Couldn’t remove that task from the focus queue.");
      setAppAnnouncement("The focus queue was not saved.");
      return false;
    }
  }

  async function reorderQueue(ids: string[], announcement: string) {
    const previous = queuedTasks;
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => {
              const index = ids.indexOf(task.id);
              return index < 0
                ? task
                : { ...task, focusQueuePosition: index };
            })
          }
        : current
    );
    try {
      const result = await reorderQueueRequest(ids, previous);

      setAppError("");
      setAppAnnouncement(announcement);
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setData((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((task) => {
                const prior = previous.find((item) => item.id === task.id);
                return prior
                  ? { ...task, focusQueuePosition: prior.focusQueuePosition }
                  : task;
              })
            }
          : current
      );
      setAppError("Couldn’t save the new queue order. Retry the move.");
      setAppAnnouncement("The new queue order was not saved.");
      await refresh().catch(() => undefined);
      return false;
    }
  }

  return { queueTask, removeQueuedTask, reorderQueue };
}
