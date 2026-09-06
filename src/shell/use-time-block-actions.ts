"use client";

import { type TimeBlockErrorField } from "@/components/time-block-dialog";
import { useViewedDay } from "@/components/use-viewed-day";
import {
  minutesToTimeBlockTime,
  TIME_BLOCK_LAST_MINUTE,
  TIME_BLOCK_SLOT_INTERVAL_MINUTES,
  type TimeBlockTaskSummary
} from "@/lib/time-blocks";
import { type Task } from "@/modules/planning/ui";
import {
  deleteTimeBlock as deleteTimeBlockRequest,
  saveTimeBlock as saveTimeBlockRequest
} from "@/modules/planning/ui/api";
import { ApiError } from "@/shared/client/api-client";
import { mutationIdFor } from "@/shared/client/mutation-ids";

import { type ShellState, type TimeBlock, type TimeBlockEditor } from "./use-shell-state";

function timeBlockErrorFieldFrom(
  value: unknown
): TimeBlockErrorField | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as { field?: unknown }).field;
  return ["title", "startTime", "endTime", "taskId"].includes(
    String(field)
  )
    ? (field as TimeBlockErrorField)
    : null;
}

function suggestedTaskBlockDuration(
  task: Pick<Task, "estimateMinutes"> | null
) {
  const estimate = task?.estimateMinutes ?? 60;
  return Math.min(
    TIME_BLOCK_LAST_MINUTE,
    Math.max(1, estimate || 30)
  );
}

export function mergeTimeBlockTaskOptions(
  tasks: TimeBlockTaskSummary[],
  editor: TimeBlockEditor | null
) {
  const result = [...tasks];
  for (const task of [editor?.originalTask, editor?.linkedTask]) {
    if (task && !result.some((candidate) => candidate.id === task.id)) {
      result.push(task);
    }
  }
  return result;
}

export function useTimeBlockActions({
  data,
  setData,
  timeBlockEditor,
  setTimeBlockEditor,
  setTimeBlockError,
  setTimeBlockErrorField,
  timeBlockSaving,
  setTimeBlockSaving,
  setAppAnnouncement,
  setAppError,
  timeBlockCreateMutation,
  timeBlockTaskCandidates,
  viewedDay,
  refreshAfterConfirmedMutation
}: Pick<
  ShellState,
  | "data"
  | "setData"
  | "timeBlockEditor"
  | "setTimeBlockEditor"
  | "setTimeBlockError"
  | "setTimeBlockErrorField"
  | "timeBlockSaving"
  | "setTimeBlockSaving"
  | "setAppAnnouncement"
  | "setAppError"
  | "timeBlockCreateMutation"
> & {
  timeBlockTaskCandidates: Task[];
  viewedDay: ReturnType<typeof useViewedDay>;
  refreshAfterConfirmedMutation: () => Promise<boolean>;
}) {
  function defaultTimeBlockTimes(durationMinutes: number) {
    const now = new Date();
    const duration = Math.min(
      TIME_BLOCK_LAST_MINUTE,
      Math.max(1, Math.trunc(durationMinutes))
    );
    const preferred =
      Math.ceil(
        (now.getHours() * 60 + now.getMinutes()) /
          TIME_BLOCK_SLOT_INTERVAL_MINUTES
      ) * TIME_BLOCK_SLOT_INTERVAL_MINUTES;
    const latestStart = TIME_BLOCK_LAST_MINUTE - duration;
    const startMinutes =
      preferred <= latestStart
        ? preferred
        : Math.max(
            0,
            Math.floor(
              latestStart / TIME_BLOCK_SLOT_INTERVAL_MINUTES
            ) * TIME_BLOCK_SLOT_INTERVAL_MINUTES
          );
    return {
      startTime: minutesToTimeBlockTime(startMinutes),
      endTime: minutesToTimeBlockTime(startMinutes + duration)
    };
  }

  function openTimeBlockEditor(
    date: string,
    task: Task | null = null
  ) {
    if (!data) return;
    const durationMinutes = suggestedTaskBlockDuration(task);
    const slot = defaultTimeBlockTimes(durationMinutes);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor({
      id: null,
      date,
      originalTask: task
        ? {
            id: task.id,
            title: task.title,
            estimateMinutes: task.estimateMinutes
          }
        : null,
      linkedTask: task
        ? {
            id: task.id,
            title: task.title,
            estimateMinutes: task.estimateMinutes
          }
        : null,
      draft: {
        title: task?.title ?? "",
        startTime: slot.startTime,
        endTime: slot.endTime,
        taskId: task?.id ?? ""
      }
    });
  }

  function editTimeBlock(block: TimeBlock) {
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor({
      id: block.id,
      date: block.date,
      originalTask: block.task,
      linkedTask: block.task,
      draft: {
        title: block.title,
        startTime: block.startTime,
        endTime: block.endTime,
        taskId: block.taskId ?? ""
      }
    });
  }

  function changeTimeBlockTask(taskId: string) {
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor((current) => {
      if (!current) return current;
      const task =
        timeBlockTaskCandidates.find((item) => item.id === taskId) ??
        (current.linkedTask?.id === taskId
          ? current.linkedTask
          : current.originalTask?.id === taskId
            ? current.originalTask
            : null);
      if (!task) {
        return {
          ...current,
          draft: { ...current.draft, taskId: "" }
        };
      }
      const slot =
        current.id === null
          ? defaultTimeBlockTimes(suggestedTaskBlockDuration(task))
          : {
              startTime: current.draft.startTime,
              endTime: current.draft.endTime
            };
      return {
        ...current,
        linkedTask: {
          id: task.id,
          title: task.title,
          estimateMinutes: task.estimateMinutes
        },
        draft: {
          title: task.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          taskId: task.id
        }
      };
    });
  }

  async function saveTimeBlock() {
    if (!data || !timeBlockEditor || timeBlockSaving) return;
    const payload = {
      date: timeBlockEditor.date,
      title: timeBlockEditor.draft.title,
      startTime: timeBlockEditor.draft.startTime,
      endTime: timeBlockEditor.draft.endTime,
      taskId: timeBlockEditor.draft.taskId || null
    };
    const creating = timeBlockEditor.id === null;
    const mutationId = creating
      ? mutationIdFor(timeBlockCreateMutation, payload)
      : null;
    setTimeBlockSaving(true);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    try {
      const result = await saveTimeBlockRequest(timeBlockEditor.id, payload, mutationId);

      setData((current) =>
        current
          ? {
              ...current,
              timeBlocks: creating
                ? [...current.timeBlocks, result]
                : current.timeBlocks.map((block) =>
                    block.id === result.id ? result : block
                  )
            }
          : current
      );
      viewedDay.acceptTimeBlock(result);
      if (creating) timeBlockCreateMutation.current = null;
      setTimeBlockError("");
      setTimeBlockErrorField(null);
      setAppError("");
      setAppAnnouncement(
        creating ? "Time block added." : "Time block updated."
      );
      const refreshed = await refreshAfterConfirmedMutation();
      if (!refreshed) {
        setTimeBlockEditor((current) =>
          current
            ? {
                id: result.id,
                date: current.date,
                originalTask: result.task,
                linkedTask: result.task,
                draft: current.draft
              }
            : current
        );
        setTimeBlockError(
          "This Time Block was saved, but the latest view could not be refreshed. Your values are still here; reload to try again."
        );
        setTimeBlockErrorField(null);
        return;
      }
      setTimeBlockEditor(null);
    } catch (failure) {
      if (failure instanceof ApiError) {
        setTimeBlockError(
          failure.message
        );
        setTimeBlockErrorField(timeBlockErrorFieldFrom(failure));
        return;
      }

      setTimeBlockError(
        "Time block could not be saved. Your draft is still here."
      );
      setTimeBlockErrorField(null);
    } finally {
      setTimeBlockSaving(false);
    }
  }

  async function deleteTimeBlock() {
    if (!timeBlockEditor?.id || timeBlockSaving) return;
    const id = timeBlockEditor.id;
    setTimeBlockSaving(true);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    try {
      const result = await deleteTimeBlockRequest(id);
      viewedDay.removeTimeBlock(id);

      setData((current) =>
        current
          ? {
              ...current,
              timeBlocks: current.timeBlocks.filter(
                (block) => block.id !== id
              )
            }
          : current
      );
      setTimeBlockEditor(null);
      setTimeBlockErrorField(null);
      setAppError("");
      setAppAnnouncement("Time block deleted.");
      await refreshAfterConfirmedMutation();
    } catch (failure) {
      if (failure instanceof ApiError) {
        setTimeBlockError(
          failure.message
        );
        setTimeBlockErrorField(null);
        return;
      }

      setTimeBlockError("Time block could not be deleted. Try again.");
      setTimeBlockErrorField(null);
    } finally {
      setTimeBlockSaving(false);
    }
  }

  return { openTimeBlockEditor, editTimeBlock, changeTimeBlockTask, saveTimeBlock, deleteTimeBlock };
}
