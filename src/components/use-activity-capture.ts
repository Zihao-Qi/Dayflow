"use client";

import { useMemo, useRef, useState } from "react";
import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  DEFAULT_ACTIVITY_CATEGORY
} from "@/lib/activity-categories";
import { localDateKey, parseLocalDate } from "@/lib/dates";
import { formatLongLocalDateKey } from "@/components/dashboard-formatters";
import {
  ActivityDraft,
  ActivityEditor,
  ActivityEntry,
  ActivityTaskOption,
  PendingMutation,
  formatTimeInput,
  isActivityResponse,
  mutationIdFor
} from "@/components/activity-records";

type TaskRecord = { id: string; title: string; projectId: string | null };

type ActivityCaptureInput = {
  /** Today's local calendar key, or null before bootstrap has resolved. */
  todayKey: string | null;
  /** Tasks offered in the dialog's Task selector. */
  todayTasks: TaskRecord[];
  /**
   * Every task the workspace knows about, used to name a Task an edited
   * Activity still points at even when it is no longer scheduled for today.
   */
  knownTasks: TaskRecord[];
  /** Replaces one Activity in the bootstrap store after a confirmed edit. */
  replaceActivity: (activity: ActivityEntry) => void;
  announce: (message: string) => void;
  /** Resolves once the workspace has reloaded; its result is not used here. */
  refreshAfterConfirmedMutation: () => Promise<unknown>;
};

/**
 * Owns everything the manual Activity dialog needs: its open state, the create
 * draft, the edit draft, validation, and the save request. Lifted out of
 * `Dashboard` so this one feature reads as one unit instead of eight variables
 * scattered through a 2,000-line component.
 */
export function useActivityCapture({
  todayKey,
  todayTasks,
  knownTasks,
  replaceActivity,
  announce,
  refreshAfterConfirmedMutation
}: ActivityCaptureInput) {
  const [open, setOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<ActivityDraft>({
    date: "",
    time: "",
    duration: "30",
    category: DEFAULT_ACTIVITY_CATEGORY,
    taskId: "",
    projectId: "",
    note: ""
  });
  const [editor, setEditor] = useState<ActivityEditor | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const createWasInError = useRef(false);
  const editWasInError = useRef(false);
  const createMutation = useRef<PendingMutation | null>(null);

  const draft = editor?.draft ?? createDraft;

  const dialogTasks = useMemo(() => {
    const options: ActivityTaskOption[] = todayTasks.map(
      ({ id, title, projectId }) => ({ id, title, projectId })
    );
    const original = editor?.original;
    if (!original?.taskId || options.some(({ id }) => id === original.taskId)) {
      return options;
    }
    const task = knownTasks.find(({ id }) => id === original.taskId);
    options.push(
      task
        ? { id: task.id, title: task.title, projectId: task.projectId }
        : {
            id: original.taskId,
            title: "Previously linked task",
            projectId:
              original.projectId === null
                ? original.attributedProjectId
                : null
          }
    );
    return options;
  }, [editor?.original, knownTasks, todayTasks]);

  /** Seeds the create draft's clock on first mount, before any dialog opens. */
  function initializeClock() {
    setCreateDraft((current) => ({
      ...current,
      time: formatTimeInput(new Date())
    }));
  }

  function openCreate() {
    setCreateDraft((current) =>
      current.note
        ? current
        : {
            ...current,
            date: todayKey ?? current.date,
            time: formatTimeInput(new Date())
          }
    );
    setEditor(null);
    setError("");
    setOpen(true);
  }

  function openEdit(activity: ActivityEntry) {
    if (activity.origin !== "MANUAL" || activity.focusSessionId) return;
    setEditor({
      original: activity,
      draft: {
        date: localDateKey(new Date(activity.startedAt)),
        time: formatTimeInput(new Date(activity.startedAt)),
        duration: String(activity.durationMinutes),
        category: activity.category,
        taskId: activity.taskId ?? "",
        projectId: activity.projectId ?? "",
        note: activity.note
      }
    });
    setError("");
    setOpen(true);
  }

  function changeDraft(patch: Partial<ActivityDraft>) {
    if (editor) {
      setEditor((current) =>
        current ? { ...current, draft: { ...current.draft, ...patch } } : current
      );
    } else {
      setCreateDraft((current) => ({ ...current, ...patch }));
    }
    setError("");
  }

  function close() {
    setOpen(false);
    setEditor(null);
    setError("");
  }

  async function save() {
    if (saving) return;
    const activeEditor = editor;
    const activeDraft = activeEditor?.draft ?? createDraft;
    const minutes = Number(activeDraft.duration);
    if (!activeDraft.note.trim()) {
      setError("Add a short note about what happened.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Duration must be between 1 and 1440 minutes.");
      return;
    }
    const selectedDate = activeDraft.date.trim();
    if (
      !activeEditor &&
      (!parseLocalDate(selectedDate) ||
        !todayKey ||
        selectedDate > todayKey)
    ) {
      setError("Choose today or an earlier Activity date.");
      return;
    }
    const selectedCategory = activeDraft.category.trim();
    if (
      !selectedCategory ||
      selectedCategory.length > ACTIVITY_CATEGORY_MAX_LENGTH
    ) {
      setError(
        `Category must contain 1 to ${ACTIVITY_CATEGORY_MAX_LENGTH} characters.`
      );
      return;
    }
    const editable = {
      startTime: activeDraft.time,
      durationMinutes: minutes,
      category: selectedCategory,
      taskId: activeDraft.taskId || null,
      projectId: activeDraft.projectId || null,
      note: activeDraft.note.trim()
    };
    const selectedTaskProjectId =
      dialogTasks.find(({ id }) => id === editable.taskId)?.projectId ?? null;
    const expectedAttributedProjectId =
      activeEditor &&
      editable.taskId === activeEditor.original.taskId &&
      editable.projectId === activeEditor.original.projectId &&
      activeEditor.original.projectId === null &&
      activeEditor.original.attributedProjectId
        ? activeEditor.original.attributedProjectId
        : selectedTaskProjectId ?? editable.projectId;
    const payload = activeEditor
      ? editable
      : { ...editable, date: selectedDate };
    const mutationId = activeEditor
      ? null
      : mutationIdFor(createMutation, payload);
    setSaving(true);
    try {
      const response = await fetch(
        activeEditor
          ? `/api/activities/${encodeURIComponent(activeEditor.original.id)}`
          : "/api/activities",
        {
          method: activeEditor ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(mutationId ? { "X-Dayflow-Mutation-Id": mutationId } : {})
          },
          body: JSON.stringify(payload)
        }
      );
      const result = await response.json().catch(() => null);
      const expectedDate = activeEditor
        ? localDateKey(new Date(activeEditor.original.startedAt))
        : selectedDate;
      if (
        !response.ok ||
        !isActivityResponse(result) ||
        (activeEditor && result.id !== activeEditor.original.id) ||
        (activeEditor && result.createdAt !== activeEditor.original.createdAt) ||
        (activeEditor &&
          Date.parse(result.updatedAt) <=
            Date.parse(activeEditor.original.updatedAt)) ||
        result.origin !== "MANUAL" ||
        result.focusSessionId !== null ||
        localDateKey(new Date(result.startedAt)) !== expectedDate ||
        formatTimeInput(new Date(result.startedAt)) !== editable.startTime ||
        result.note !== payload.note ||
        result.durationMinutes !== payload.durationMinutes ||
        result.category !== payload.category ||
        result.taskId !== editable.taskId ||
        result.projectId !== editable.projectId ||
        result.attributedProjectId !== expectedAttributedProjectId
      ) {
        setError(
          result && typeof result.error === "string"
            ? result.error
            : activeEditor
              ? "Activity could not be updated. Your draft is still here."
              : "Activity could not be saved. Your draft is still here."
        );
        if (activeEditor) {
          editWasInError.current = true;
        } else {
          createWasInError.current = true;
        }
        return;
      }
      if (activeEditor) {
        replaceActivity(result);
        setEditor(null);
      } else {
        setCreateDraft((current) => ({
          ...current,
          date: todayKey ?? current.date,
          note: "",
          taskId: "",
          projectId: ""
        }));
        createMutation.current = null;
        if (selectedDate !== todayKey) {
          announce(
            `Activity saved for ${formatLongLocalDateKey(selectedDate)}.`
          );
        }
      }
      setError("");
      setOpen(false);
      if (
        activeEditor ? editWasInError.current : createWasInError.current
      ) {
        editWasInError.current = false;
        createWasInError.current = false;
        announce("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch {
      setError(
        activeEditor
          ? "Activity could not be updated. Your draft is still here."
          : "Activity could not be saved. Your draft is still here."
      );
      if (activeEditor) {
        editWasInError.current = true;
      } else {
        createWasInError.current = true;
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    open,
    editor,
    draft,
    dialogTasks,
    error,
    saving,
    initializeClock,
    openCreate,
    openEdit,
    changeDraft,
    close,
    save
  };
}
