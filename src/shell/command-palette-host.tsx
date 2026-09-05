"use client";

import { useFocusSession } from "@/components/focus-session-provider";
import { useActivityCapture } from "@/components/use-activity-capture";
import { resolvePalette, type PaletteItem } from "@/lib/command-palette";
import type { QueuePlacement } from "@/lib/focus-queue";
import { useBacklogPage, type FocusTarget, type Task } from "@/modules/planning/ui";
import { useMemo } from "react";

import { type Screen, type ShellState } from "./use-shell-state";

export function useCommandPaletteHost({
  data,
  screen,
  setScreen,
  setRailExpanded,
  setPaletteOpen,
  paletteQuery,
  setPaletteQuery,
  journal,
  setNewTask,
  setNoteDraft,
  setMaterialDraft,
  setSelectedProjectId,
  setProjectCreateOpen,
  setFocusDraft,
  setMobileMoreOpen,
  paletteOpener,
  focus,
  compactLayout,
  backlog,
  activity,
  queueTask
}: Pick<
  ShellState,
  | "data"
  | "screen"
  | "setScreen"
  | "setRailExpanded"
  | "setPaletteOpen"
  | "paletteQuery"
  | "setPaletteQuery"
  | "journal"
  | "setNewTask"
  | "setNoteDraft"
  | "setMaterialDraft"
  | "setSelectedProjectId"
  | "setProjectCreateOpen"
  | "setFocusDraft"
  | "setMobileMoreOpen"
  | "paletteOpener"
> & {
  focus: ReturnType<typeof useFocusSession>;
  compactLayout: boolean;
  backlog: ReturnType<typeof useBacklogPage>;
  activity: ReturnType<typeof useActivityCapture>;
  queueTask: (task: Pick<Task, "id" | "title">, placement: QueuePlacement) => Promise<boolean>;
}) {
  const paletteResolution = useMemo(
    () =>
      resolvePalette({
        query: paletteQuery,
        tasks: (data?.paletteTasks ?? []).map(({ id, title }) => ({ id, title })),
        projects: (data?.projects ?? [])
          .filter((project) => project.status === "ACTIVE")
          .map(({ id, name }) => ({ id, name })),
        hasActiveFocus: Boolean(focus.active ?? focus.pendingCompletion),
        activeFocusTaskId:
          focus.active?.taskId ?? focus.pendingCompletion?.taskId ?? null
      }),
    [
      data?.paletteTasks,
      data?.projects,
      focus.active,
      focus.pendingCompletion,
      paletteQuery
    ]
  );

  function openCommandPalette() {
    if (
      document.querySelector<HTMLElement>(
        '[role="dialog"][aria-modal="true"]'
      )
    ) {
      return;
    }
    paletteOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setMobileMoreOpen(false);
    setPaletteQuery("");
    setPaletteOpen(true);
  }

  function dismissCommandPalette() {
    const opener = paletteOpener.current;
    closeCommandPaletteForHandoff();
    window.setTimeout(() => {
      if (opener?.isConnected) opener.focus();
    }, 0);
  }

  function closeCommandPaletteForHandoff() {
    setPaletteOpen(false);
    setPaletteQuery("");
    paletteOpener.current = null;
  }

  function focusTaskDraft() {
    window.setTimeout(() => {
      const input =
        document.getElementById("new-task") ??
        document.getElementById("first-task");
      input?.focus();
    }, 0);
  }

  function applyPaletteDraft(
    value: string | null,
    setDraft: (value: string) => void
  ) {
    if (value !== null) setDraft(value);
  }

  function preparePaletteFocus(target: FocusTarget) {
    setFocusDraft({ ...target, revision: Date.now() });
    setRailExpanded(true);
  }

  function activatePaletteItem(item: PaletteItem) {
    closeCommandPaletteForHandoff();

    switch (item.intent.kind) {
      case "show-focus":
        setRailExpanded(true);
        return;
      case "start-focus":
        preparePaletteFocus({ plannedMinutes: item.intent.plannedMinutes });
        return;
      case "focus-task": {
        const { taskId } = item.intent;
        const task = data?.paletteTasks.find(
          (candidate) => candidate.id === taskId
        );
        if (!task) return;
        preparePaletteFocus({
          taskId: task.id,
          label: task.title,
          plannedMinutes: task.estimateMinutes || 25
        });
        return;
      }
      case "queue-task": {
        const { taskId } = item.intent;
        const task = data?.paletteTasks.find(
          (candidate) => candidate.id === taskId
        );
        if (task) void queueTask(task, "end");
        return;
      }
      case "draft-task":
        applyPaletteDraft(item.intent.title, setNewTask);
        navigate("today");
        focusTaskDraft();
        return;
      case "draft-activity":
        activity.openCreate();
        return;
      case "draft-note":
        applyPaletteDraft(item.intent.content, (content) =>
          setNoteDraft((current) => ({ ...current, content }))
        );
        navigate("journal");
        journal.setView("notes");
        window.setTimeout(
          () => document.getElementById("new-note")?.focus(),
          0
        );
        return;
      case "draft-reference":
        applyPaletteDraft(item.intent.url, (url) =>
          setMaterialDraft((current) => ({ ...current, url }))
        );
        navigate("journal");
        journal.setView("references");
        window.setTimeout(
          () => document.getElementById("material-url")?.focus(),
          0
        );
        return;
      case "open-project":
        openProject(item.intent.projectId);
        return;
    }
  }

  function navigate(next: Screen) {
    setScreen(next);
    setRailExpanded(false);
    closeCommandPaletteForHandoff();
    setMobileMoreOpen(false);
    if (next !== "projects") setSelectedProjectId(null);
  }

  function openFirstProject() {
    setSelectedProjectId(null);
    setProjectCreateOpen(true);
    navigate("projects");
  }

  function openFocus(target: FocusTarget) {
    if (compactLayout && target.plannedMinutes) {
      closeCommandPaletteForHandoff();
      void focus.start({
        kind: "FOCUS",
        plannedMinutes: target.plannedMinutes,
        label: target.label,
        taskId: target.taskId ?? null,
        projectId: target.taskId ? null : target.projectId ?? null
      });
      return;
    }
    setFocusDraft({ ...target, revision: Date.now() });
    closeCommandPaletteForHandoff();
    if (screen !== "today") setRailExpanded(true);
  }

  function openProject(id: string) {
    setSelectedProjectId(id);
    setScreen("projects");
    setRailExpanded(false);
    closeCommandPaletteForHandoff();
  }

  function openProjectBacklog(id: string) {
    backlog.setArrangement("project");
    backlog.setScopeProjectId(id);
    navigate("backlog");
  }

  return { paletteResolution, openCommandPalette, dismissCommandPalette, activatePaletteItem, navigate, openFirstProject, openFocus, openProject, openProjectBacklog };
}
