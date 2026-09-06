"use client";

import { ActivityEntry } from "@/components/activity-records";
import { useFocusSession } from "@/components/focus-session-provider";
import { useActivityCapture } from "@/components/use-activity-capture";
import { useLayoutMode } from "@/components/use-layout-mode";
import { useViewedDay } from "@/components/use-viewed-day";
import { localDateKey, parseLocalDate } from "@/lib/dates";
import { DEFAULT_FOCUS_MINUTES } from "@/lib/focus-domain";
import { useBacklogPage, useTodayPage, type Task } from "@/modules/planning/ui";
import { safeTimeBlockDurationMinutes } from "@/modules/planning/ui/log/day-workspace-helpers";
import { useEffect, useMemo } from "react";

import { useCommandPaletteHost } from "./command-palette-host";
import { useBootstrap } from "./use-bootstrap";
import { useJournalActions } from "./use-journal-actions";
import { useQueueActions } from "./use-queue-actions";
import { useReviewActions } from "./use-review-actions";
import { useShellState, type TimeBlock } from "./use-shell-state";
import { useTaskActions } from "./use-task-actions";
import { useTimeBlockActions } from "./use-time-block-actions";

export function useShellModel() {
  const focus = useFocusSession();
  const {
    mode: layoutMode,
    figureArrangement,
    wideFocusRail
  } = useLayoutMode();
  const compactLayout = layoutMode !== "desktop";
  const phoneLayout = layoutMode === "phone";
  const state = useShellState();
  const {
    data,
    setData,
    screen,
    setRailExpanded,
    paletteOpen,
    projectById,
    setFocusDraft,
    timeBlockEditor,
    dismissedUnfinished,
    setAppAnnouncement
  } = state;
  const {
    refresh,
    retryBootstrap,
    refreshAfterConfirmedMutation
  } = useBootstrap({
    ...state,
    focus,
    // Bootstrap effects run after the activity hook below has initialized.
    initializeActivityClock: () => activity.initializeClock()
  });
  useEffect(() => {
    if (focus.retryNext) setRailExpanded(true);
  }, [focus.retryNext]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) {
          dismissCommandPalette();
        } else {
          openCommandPalette();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!focus.active) {
          setFocusDraft({ revision: Date.now(), plannedMinutes: DEFAULT_FOCUS_MINUTES });
          if (screen !== "today") setRailExpanded(true);
        }
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [focus.active, paletteOpen, screen]);

  const todayTasks = useMemo(() => {
    if (!data) return [];
    const key = data.todayKey;
    return data.tasks
      .filter(
        (task) =>
          taskDateLocalKey(task.date) === key
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  const openTodayTasks = todayTasks.filter((task) => task.status !== "DONE");
  const doneTodayTasks = todayTasks.filter((task) => task.status === "DONE");
  const activityKnownTasks = useMemo(
    () => [...(data?.tasks ?? []), ...(data?.paletteTasks ?? [])],
    [data?.paletteTasks, data?.tasks]
  );
  const activity = useActivityCapture({
    todayKey: data?.todayKey ?? null,
    todayTasks,
    knownTasks: activityKnownTasks,
    replaceActivity: (saved) =>
      setData((current) =>
        current
          ? {
              ...current,
              activities: current.activities
                .map((entry) => (entry.id === saved.id ? saved : entry))
                .sort(
                  (left, right) =>
                    new Date(right.startedAt).getTime() -
                    new Date(left.startedAt).getTime()
                )
            }
          : current
      ),
    announce: setAppAnnouncement,
    refreshAfterConfirmedMutation
  });
  const backlogTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((task) => !task.date && task.status !== "DONE")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );
  const backlog = useBacklogPage(
    figureArrangement,
    data && {
      tasks: backlogTasks,
      projects: projectById,
      today: data.today
    }
  );
  const queuedTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter(
          (task) =>
            task.status !== "DONE" && task.focusQueuePosition !== null
        )
        .sort(
          (a, b) =>
            (a.focusQueuePosition ?? Number.MAX_SAFE_INTEGER) -
            (b.focusQueuePosition ?? Number.MAX_SAFE_INTEGER)
        ),
    [data]
  );
  const today = useTodayPage(
    data && {
      today: data.today,
      tasks: todayTasks,
      backlogTasks,
      unfinishedTasks: data.unfinishedTasks,
      projects: data.projects,
      projectById,
      activities: data.activities
    },
    {
      layoutMode,
      focusedMinutes: focus.snapshot?.today.focusedMinutes ?? 0,
      activeFocus: focus.active,
      focusNow: focus.now,
      focusBusy: focus.busy
    },
    dismissedUnfinished
  );
  const viewedDay = useViewedDay(
    data?.todayKey ?? "",
    data?.earliestDayKey ?? null,
    data?.dayViewForwardWeeks ?? null
  );
  const onDay = screen.startsWith("day-");

  // Leaving Log resets the day: one that persists across a detour through
  // Projects or Journal invites acting on the wrong day without noticing.
  useEffect(() => {
    if (!onDay) viewedDay.goToToday();
  }, [onDay, viewedDay.goToToday]);

  const dayIsToday = viewedDay.dayKey === (data?.todayKey ?? "");
  const dayTasks = dayIsToday
    ? openTodayTasks
    : ((viewedDay.payload?.tasks ?? []) as unknown as Task[]).filter(
        (task) => task.status !== "DONE"
      );
  const dayActivities = dayIsToday
    ? data?.activities ?? []
    : ((viewedDay.payload?.activities ?? []) as unknown as ActivityEntry[]);
  const dayTimeBlocks = dayIsToday
    ? data?.timeBlocks ?? []
    : ((viewedDay.payload?.timeBlocks ?? []) as unknown as TimeBlock[]);
  const dayBlockedMinutes = dayTimeBlocks
    .filter((block) => block.date === viewedDay.dayKey)
    .reduce((sum, block) => sum + safeTimeBlockDurationMinutes(block), 0);
  const dayRecordedMinutes = dayActivities.reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );

  const blockedMinutes = (data?.timeBlocks ?? [])
    .filter(
      (block) => block.date === data?.todayKey
    )
    .reduce(
      (sum, block) => sum + safeTimeBlockDurationMinutes(block),
      0
    );
  const activityMinutes = (data?.activities ?? []).reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );
  const {
    paletteResolution,
    openCommandPalette,
    dismissCommandPalette,
    activatePaletteItem,
    navigate,
    openFirstProject,
    openFocus,
    openProject,
    openProjectBacklog
  } = useCommandPaletteHost({
    ...state,
    focus,
    compactLayout,
    backlog,
    activity,
    // Preserve the original late-bound handoff to the queue actions below.
    queueTask: (task, placement) => queueTask(task, placement)
  });
  const {
    addTask,
    beginFirstRun,
    saveTaskAttempt,
    reportTaskSaveFailure,
    reportTaskSaveRecovery,
    updateTask,
    deleteTask,
    reorderTask
  } = useTaskActions({
    ...state,
    openTodayTasks,
    refresh,
    refreshAfterConfirmedMutation,
    openFocus
  });
  const {
    queueTask,
    removeQueuedTask,
    reorderQueue
  } = useQueueActions({
    ...state,
    queuedTasks,
    refresh,
    refreshAfterConfirmedMutation
  });
  const {
    selectNoteTask,
    selectMaterialTask,
    addNote,
    addMaterial,
    saveDiary,
    reportDiarySaveFailure,
    reportDiarySaveRecovery,
    setDiaryValue
  } = useJournalActions({
    ...state,
    refreshAfterConfirmedMutation
  });
  const {
    saveReview,
    reportReviewSaveFailure,
    reportReviewSaveRecovery
  } = useReviewActions({
    ...state,
    refresh,
    refreshAfterConfirmedMutation
  });
  // Pure selection moved before the loading return to supply the handler hook.
  const timeBlockTaskCandidates =
    timeBlockEditor &&
    !dayIsToday &&
    timeBlockEditor.date === viewedDay.dayKey
      ? dayTasks
      : openTodayTasks;
  const {
    openTimeBlockEditor,
    editTimeBlock,
    changeTimeBlockTask,
    saveTimeBlock,
    deleteTimeBlock
  } = useTimeBlockActions({
    ...state,
    timeBlockTaskCandidates,
    viewedDay,
    refreshAfterConfirmedMutation
  });

  return {
    ...state,
    focus,
    compactLayout,
    phoneLayout,
    wideFocusRail,
    openTodayTasks,
    activity,
    backlogTasks,
    backlog,
    queuedTasks,
    today,
    viewedDay,
    dayTasks,
    dayActivities,
    dayTimeBlocks,
    dayBlockedMinutes,
    dayRecordedMinutes,
    timeBlockTaskCandidates,
    refresh,
    retryBootstrap,
    paletteResolution,
    openCommandPalette,
    dismissCommandPalette,
    activatePaletteItem,
    navigate,
    openFirstProject,
    openFocus,
    openProject,
    openProjectBacklog,
    addTask,
    beginFirstRun,
    saveTaskAttempt,
    reportTaskSaveFailure,
    reportTaskSaveRecovery,
    updateTask,
    deleteTask,
    reorderTask,
    queueTask,
    removeQueuedTask,
    reorderQueue,
    selectNoteTask,
    selectMaterialTask,
    addNote,
    addMaterial,
    saveDiary,
    reportDiarySaveFailure,
    reportDiarySaveRecovery,
    setDiaryValue,
    saveReview,
    reportReviewSaveFailure,
    reportReviewSaveRecovery,
    openTimeBlockEditor,
    editTimeBlock,
    changeTimeBlockTask,
    saveTimeBlock,
    deleteTimeBlock
  };
}

function taskDateLocalKey(value: string | null) {
  if (!value) return null;
  const date = parseLocalDate(value);
  return date ? localDateKey(date) : null;
}
