"use client";

import { DEFAULT_FOCUS_MINUTES } from "@/lib/focus-domain";
import { describeTaskMove, type FocusTarget, type Task } from "@/modules/planning/ui";
import {
  createFirstTask as createFirstTaskRequest,
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  reorderTasks as reorderTasksRequest,
  updateTask as updateTaskRequest
} from "@/modules/planning/ui/api";
import { ApiError } from "@/shared/client/api-client";
import { mutationIdFor } from "@/shared/client/mutation-ids";

import { type ShellState } from "./use-shell-state";

export function useTaskActions({
  data,
  setData,
  newTask,
  setNewTask,
  taskCreatePending,
  setTaskCreatePending,
  setFirstRunSeen,
  setAppAnnouncement,
  setAppError,
  taskSaveWasInError,
  taskCreateWasInError,
  taskCreateMutation,
  openTodayTasks,
  acceptTask,
  removeTask,
  refresh,
  refreshAfterConfirmedMutation,
  openFocus
}: Pick<
  ShellState,
  | "data"
  | "setData"
  | "newTask"
  | "setNewTask"
  | "taskCreatePending"
  | "setTaskCreatePending"
  | "setFirstRunSeen"
  | "setAppAnnouncement"
  | "setAppError"
  | "taskSaveWasInError"
  | "taskCreateWasInError"
  | "taskCreateMutation"
> & {
  openTodayTasks: Task[];
  acceptTask: (task: Task) => void;
  removeTask: (id: string) => void;
  refresh: () => Promise<void>;
  refreshAfterConfirmedMutation: () => Promise<boolean>;
  openFocus: (target: FocusTarget) => void;
}) {
  async function addTask(date: string | null = data?.todayKey ?? null) {
    const title = newTask.trim();
    if (!title || taskCreatePending) return false;
    const payload = { title, date, estimateMinutes: 30 };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    setTaskCreatePending(true);
    try {
      const result = await createTaskRequest(payload, mutationId);
      acceptTask(result);

      setNewTask((current) => (current.trim() === title ? "" : current));
      taskCreateMutation.current = null;
      setAppError("");
      if (taskCreateWasInError.current) {
        taskCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
      return true;
    } catch (failure) {
      if (failure instanceof ApiError) {
        const message =
          failure.message;
        setAppError(message);
        setAppAnnouncement("Task was not saved.");
        taskCreateWasInError.current = true;
        return false;
      }

      setAppError("Your task was not saved. Your draft is still here.");
      setAppAnnouncement("Task was not saved.");
      taskCreateWasInError.current = true;
      return false;
    } finally {
      setTaskCreatePending(false);
    }
  }

  async function beginFirstRun(title: string, startFocus: boolean) {
    const trimmed = title.trim();
    if (!trimmed || !data || taskCreatePending) return;
    const payload = {
      title: trimmed,
      date: data.todayKey,
      estimateMinutes: 25
    };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    setTaskCreatePending(true);
    try {
      const result = await createFirstTaskRequest(payload, mutationId);
      acceptTask(result);

      window.localStorage.setItem("dayflow-first-run-seen", "1");
      taskCreateMutation.current = null;
      setNewTask((current) => (current.trim() === trimmed ? "" : current));
      setFirstRunSeen(true);
      setAppError("");
      if (taskCreateWasInError.current) {
        taskCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
      if (startFocus) {
        openFocus({
          taskId: result.id,
          label: result.title,
          plannedMinutes: DEFAULT_FOCUS_MINUTES
        });
      }
    } catch (failure) {
      if (failure instanceof ApiError) {
        setAppError(
          failure.message
        );
        taskCreateWasInError.current = true;
        return;
      }

      setAppError("Your first task was not saved. Your draft is still here.");
      taskCreateWasInError.current = true;
    } finally {
      setTaskCreatePending(false);
    }
  }

  async function saveTaskAttempt(
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) {
    const { scheduleSource: _scheduleSource, ...taskPatch } = patch;
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id ? { ...task, ...taskPatch } : task
            )
          }
        : current
    );
    try {
      const result = await updateTaskRequest(id, patch);
      acceptTask(result);
      setAppError("");

      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      return false;
    }
  }

  function reportTaskSaveFailure() {
    taskSaveWasInError.current = true;
    setAppError("Couldn’t save that change. Your text is still here — retry.");
    setAppAnnouncement("Changes were not saved.");
  }

  function reportTaskSaveRecovery() {
    if (!taskSaveWasInError.current) return;
    taskSaveWasInError.current = false;
    setAppError("");
    setAppAnnouncement("Saved.");
  }

  async function updateTask(
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await saveTaskAttempt(id, patch)) {
        reportTaskSaveRecovery();
        return true;
      }
      if (attempt < 2) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, attempt === 0 ? 1000 : 4000)
        );
      }
    }
    reportTaskSaveFailure();
    return false;
  }

  async function deleteTask(id: string) {
    try {
      const result = await deleteTaskRequest(id);
      removeTask(id);

      setAppError("");
      await refreshAfterConfirmedMutation();
    } catch (failure) {
      if (failure instanceof ApiError) {
        setAppError(
          failure.message
        );
        return;
      }

      setAppError("Task could not be deleted.");
    }
  }

  async function reorderTask(
    draggedId: string,
    targetId: string,
    announce = true
  ) {
    if (draggedId === targetId) return true;
    const oldIndex = openTodayTasks.findIndex((task) => task.id === draggedId);
    const newIndex = openTodayTasks.findIndex((task) => task.id === targetId);
    if (oldIndex < 0 || newIndex < 0) return false;
    const reordered = [...openTodayTasks];
    const [item] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, item);
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => {
              const index = reordered.findIndex((candidate) => candidate.id === task.id);
              return index < 0 ? task : { ...task, sortOrder: index };
            })
          }
        : current
    );
    try {
      const result = await reorderTasksRequest(reordered);
      result.tasks.forEach(acceptTask);

      setAppError("");
      if (announce) {
        setAppAnnouncement(
          describeTaskMove(item.title, newIndex, reordered.length)
        );
      }
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Couldn’t save the new order. Retry the move.");
      setAppAnnouncement("The new task order was not saved.");
      await refresh().catch(() => undefined);
      return false;
    }
  }

  return { addTask, beginFirstRun, saveTaskAttempt, reportTaskSaveFailure, reportTaskSaveRecovery, updateTask, deleteTask, reorderTask };
}
