"use client";

import { ActivityEntry } from "@/components/activity-records";
import { useFocusSession } from "@/components/focus-session-provider";
import { useActivityCapture } from "@/components/use-activity-capture";
import { useLayoutMode } from "@/components/use-layout-mode";
import { useViewedDay } from "@/components/use-viewed-day";
import { localDateKey } from "@/lib/dates";
import { DEFAULT_FOCUS_MINUTES } from "@/lib/focus-domain";
import { useBacklogPage, useTodayPage, type Task } from "@/modules/planning/ui";
import { safeTimeBlockDurationMinutes } from "@/modules/planning/ui/log/day-workspace-helpers";
import { useCallback, useEffect, useMemo, useRef } from "react";

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
  const reviewRefresh = useRef<(() => Promise<boolean>) | null>(null);
  const registerReviewRefresh = useCallback((callback: (() => Promise<boolean>) | null) => {
    reviewRefresh.current = callback;
  }, []);
  const {
    refresh,
    retryBootstrap,
    refreshAfterConfirmedMutation
  } = useBootstrap({
    ...state,
    focus,
    // Bootstrap effects run after the activity hook below has initialized.
    initializeActivityClock: () => activity.initializeClock(),
    refreshDestination: (todayKey) => {
      if (screen === "today" || screen.startsWith("day-")) return viewedDay.refresh(todayKey);
      if (screen === "review") return reviewRefresh.current?.() ?? Promise.resolve(true);
      return Promise.resolve(true);
    }
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

  const onDay = screen.startsWith("day-");
  const viewedDay = useViewedDay(
    data?.todayKey ?? "",
    data?.earliestDayKey ?? null,
    data?.dayViewForwardWeeks ?? null,
    screen === "today" ? "today" : onDay ? "log" : null
  );
  const todayTasks = viewedDay.dayKey === data?.todayKey
    ? (viewedDay.payload?.tasks ?? [])
    : [];
  const openTodayTasks = todayTasks.filter((task) => task.status !== "DONE");
  const todayTaskCount = (data?.tasks ?? []).filter((task) =>
    task.status !== "DONE" && task.date && localDateKey(new Date(task.date)) === data?.todayKey
  ).length;
  const activityKnownTasks = useMemo(
    () => [...(data?.tasks ?? []), ...(data?.paletteTasks ?? [])],
    [data?.paletteTasks, data?.tasks]
  );
  const activity = useActivityCapture({
    todayKey: data?.todayKey ?? null,
    todayTasks: screen === "today" || (onDay && viewedDay.dayKey === data?.todayKey)
      ? todayTasks
      : (data?.tasks ?? []).filter((task) => task.date && localDateKey(new Date(task.date)) === data?.todayKey),
    knownTasks: activityKnownTasks,
    replaceActivity: (saved) => {
      viewedDay.acceptActivity(saved);
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
      );
    },
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
    data && viewedDay.payload && {
      today: data.today,
      tasks: todayTasks,
      backlogTasks,
      unfinishedTasks: data.unfinishedTasks,
      projects: data.projects,
      projectById,
      activities: (viewedDay.payload.activities ?? []) as ActivityEntry[]
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
  const dayIsToday = viewedDay.dayKey === (data?.todayKey ?? "");
  const dayTasks = (viewedDay.payload?.tasks ?? []).filter((task) => task.status !== "DONE");
  const dayActivities = (viewedDay.payload?.activities ?? []) as ActivityEntry[];
  const dayTimeBlocks = (viewedDay.payload?.timeBlocks ?? []) as TimeBlock[];
  const dayBlockedMinutes = dayTimeBlocks
    .filter((block) => block.date === viewedDay.dayKey)
    .reduce((sum, block) => sum + safeTimeBlockDurationMinutes(block), 0);
  const dayRecordedMinutes = dayActivities.reduce(
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
    patchTask: viewedDay.patchTask,
    acceptTask: viewedDay.acceptTask,
    removeTask: viewedDay.removeTask,
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
    registerReviewRefresh,
    focus,
    compactLayout,
    phoneLayout,
    wideFocusRail,
    todayTaskCount,
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
