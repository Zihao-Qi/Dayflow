"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusSession } from "@/components/focus-session-provider";
import { DEFAULT_FOCUS_MINUTES, suggestedBreakMinutes } from "@/lib/focus-domain";
import type { FocusRailProps, FocusQueueEntry, FocusTask } from "./focus-model";

// Called by FocusRail in both full and strip modes so setup and queue state
// keep the same lifetime as the rail, including while a session is active.
export function useFocusTimer({
  tasks,
  projects,
  today,
  draft,
  queuedTasks: queuedTaskInput = []
}: Pick<FocusRailProps, "tasks" | "projects" | "today" | "draft" | "queuedTasks">) {
  const focus = useFocusSession();
  const {
    snapshot,
    active,
    pendingCompletion,
    now,
    busy,
    error,
    notificationState
  } = focus;
  const [preset, setPreset] = useState<"25" | "50" | "custom">(
    `${DEFAULT_FOCUS_MINUTES}`
  );
  const [customMinutes, setCustomMinutes] = useState("30");
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const [breakQueuePosition, setBreakQueuePosition] = useState<
    number | null | undefined
  >(undefined);
  const carryBreakPreference = useRef(false);

  useEffect(() => {
    if (!draft) return;
    setTaskId(draft.taskId ?? "");
    setProjectId(draft.projectId ?? "");
    setLabel(draft.label ?? "");
    setSelectionInitialized(true);
    if (draft.plannedMinutes === 25 || draft.plannedMinutes === 50) {
      setPreset(String(draft.plannedMinutes) as "25" | "50");
    } else if (draft.plannedMinutes) {
      setPreset("custom");
      setCustomMinutes(String(draft.plannedMinutes));
    }
  }, [draft]);

  const selectedTask = tasks.find((task) => task.id === taskId) ?? null;
  const selectedProjectId = selectedTask?.projectId ?? projectId;
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const todayKey = today.slice(0, 10);
  const orderedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const aQueued = a.focusQueuePosition === null || a.focusQueuePosition === undefined
          ? 1
          : 0;
        const bQueued = b.focusQueuePosition === null || b.focusQueuePosition === undefined
          ? 1
          : 0;
        if (aQueued !== bQueued) return aQueued - bQueued;
        if (!aQueued && !bQueued) {
          const queueDifference =
            (a.focusQueuePosition ?? 0) - (b.focusQueuePosition ?? 0);
          if (queueDifference) return queueDifference;
        }
        const aToday = a.date?.slice(0, 10) === todayKey ? 0 : 1;
        const bToday = b.date?.slice(0, 10) === todayKey ? 0 : 1;
        return aToday - bToday || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      }),
    [tasks, todayKey]
  );

  // Rendering order only. `orderedTasks` still decides which task is
  // preselected; this regroups the same tasks so a title like "edge" arrives
  // with the Project that gives it meaning.
  const taskGroups = useMemo(() => {
    const projectName = new Map(
      projects.map((project) => [project.id, project.name])
    );
    // Keyed by a stable id, not by the label: a Project genuinely named
    // "Backlog" or "Scheduled today", or two Projects sharing a name, would
    // otherwise be merged into one group and lose the context this exists to
    // provide.
    const groups = new Map<string, { label: string; items: FocusTask[] }>();
    const push = (key: string, label: string, task: FocusTask) => {
      const existing = groups.get(key);
      if (existing) existing.items.push(task);
      else groups.set(key, { label, items: [task] });
    };

    for (const task of orderedTasks) {
      if (task.focusQueuePosition !== null && task.focusQueuePosition !== undefined) {
        push("queue", "In the focus queue", task);
      } else if (task.date?.slice(0, 10) === todayKey) {
        push("today", "Scheduled today", task);
      } else if (task.projectId) {
        push(
          `project:${task.projectId}`,
          projectName.get(task.projectId) ?? "Other projects",
          task
        );
      } else {
        push("backlog", "Backlog", task);
      }
    }

    return [...groups].map(([key, group]) => ({ key, ...group }));
  }, [orderedTasks, projects, todayKey]);

  useEffect(() => {
    if (selectionInitialized || active || draft) return;
    const nextTask = orderedTasks[0];
    if (nextTask) {
      setTaskId(nextTask.id);
      setProjectId("");
    }
    setSelectionInitialized(true);
  }, [active, draft, orderedTasks, selectionInitialized]);
  const previousLiveSessionId = useRef(
    active?.id ?? pendingCompletion?.id ?? null
  );
  useEffect(() => {
    const liveSessionId = active?.id ?? pendingCompletion?.id ?? null;
    if (previousLiveSessionId.current && !liveSessionId) {
      const nextTask = orderedTasks[0];
      setTaskId(nextTask?.id ?? "");
      setProjectId("");
      setSelectionInitialized(true);
    }
    previousLiveSessionId.current = liveSessionId;
  }, [active?.id, orderedTasks, pendingCompletion?.id]);
  const duration = preset === "custom" ? Number(customMinutes) : Number(preset);
  const retryNextLabel = focus.retryNext
    ? focus.retryNext.kind === "BREAK"
      ? `Retry ${focus.retryNext.plannedMinutes}m break`
      : `Retry ${focus.retryNext.label || "next focus"}`
    : "";
  const queuedTasks = useMemo(
    () =>
      [...queuedTaskInput]
        .filter(
          (task) =>
            task.id !== (active?.taskId ?? pendingCompletion?.taskId)
        )
        .sort(
          (a, b) =>
            (a.focusQueuePosition ?? Number.MAX_SAFE_INTEGER) -
            (b.focusQueuePosition ?? Number.MAX_SAFE_INTEGER)
        ),
    [active?.taskId, pendingCompletion?.taskId, queuedTaskInput]
  );
  const queueSession =
    active?.kind === "FOCUS" ? active : pendingCompletion;
  const queueSessionId = queueSession?.id ?? null;
  const previousQueueSessionId = useRef(queueSessionId);
  useEffect(() => {
    if (previousQueueSessionId.current === queueSessionId) return;
    if (carryBreakPreference.current) {
      carryBreakPreference.current = false;
    } else {
      setBreakQueuePosition(undefined);
    }
    previousQueueSessionId.current = queueSessionId;
  }, [queueSessionId]);
  const effectiveBreakPosition =
    breakQueuePosition === undefined
      ? queueSession
        ? 0
        : null
      : breakQueuePosition;
  const queueEntries = useMemo(
    () =>
      buildFocusQueueEntries(
        queuedTasks,
        effectiveBreakPosition,
        suggestedBreakMinutes(queueSession?.plannedMinutes ?? 25)
      ),
    [effectiveBreakPosition, queueSession?.plannedMinutes, queuedTasks]
  );

  function prepareQueueAdvance(entry: FocusQueueEntry) {
    if (entry.kind !== "task") return;
    const remaining = queueEntries.slice(1);
    const breakIndex = remaining.findIndex((item) => item.kind === "break");
    setBreakQueuePosition(breakIndex >= 0 ? breakIndex : null);
    carryBreakPreference.current = true;
  }

  async function startFocus() {
    await focus.start({
      kind: "FOCUS",
      plannedMinutes: duration,
      label,
      taskId: taskId || null,
      projectId: !selectedTask?.projectId ? projectId || null : null
    });
  }

  return {
    focus,
    snapshot,
    active,
    pendingCompletion,
    now,
    busy,
    error,
    notificationState,
    preset,
    setPreset,
    customMinutes,
    setCustomMinutes,
    taskId,
    setTaskId,
    setProjectId,
    label,
    setLabel,
    selectedTask,
    selectedProjectId,
    selectedProject,
    orderedTasks,
    taskGroups,
    duration,
    retryNextLabel,
    queuedTasks,
    queueEntries,
    setBreakQueuePosition,
    prepareQueueAdvance,
    startFocus
  };
}

export type FocusTimerState = ReturnType<typeof useFocusTimer>;

function buildFocusQueueEntries(
  tasks: FocusTask[],
  breakPosition: number | null,
  breakMinutes: number
): FocusQueueEntry[] {
  const entries: FocusQueueEntry[] = tasks.map((task) => ({
    id: task.id,
    kind: "task",
    title: task.title,
    durationMinutes: task.estimateMinutes || 25,
    task
  }));
  if (breakPosition !== null) {
    entries.splice(
      Math.min(entries.length, Math.max(0, breakPosition)),
      0,
      {
        id: "__focus_break__",
        kind: "break",
        title: "Break — stand up",
        durationMinutes: breakMinutes
      }
    );
  }
  return entries;
}
