"use client";

import { Bell, Shrink, Timer } from "lucide-react";
import { useFocusTimer } from "./use-focus-timer";
import { FocusStrip } from "./focus-strip";
import { FocusSetup } from "./focus-setup";
import { FocusQueueCard } from "./focus-queue";
import { CompletionFocusCard } from "./focus-completion-form";
import { BreakFocusCard } from "./break-focus-card";
import { PausedFocusCard } from "./paused-focus-card";
import { RunningFocusCard } from "./running-focus-card";
import { CapturedActivities } from "./captured-activities";
import type { FocusRailProps } from "./focus-model";
export type { FocusDraft } from "./focus-model";

export function FocusRail({
  tasks,
  projects,
  today,
  draft,
  activities,
  queuedTasks: queuedTaskInput = [],
  mode,
  collapsible = false,
  onCollapse,
  onExpand,
  onOpenPalette,
  onQueueTask,
  onRemoveQueuedTask,
  onReorderQueue,
  onQueueChanged,
  onAnnounce
}: FocusRailProps) {
  const {
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
  } = useFocusTimer({
    tasks,
    projects,
    today,
    draft,
    queuedTasks: queuedTaskInput
  });

  if (mode === "strip") {
    return <FocusStrip active={active} pendingCompletion={pendingCompletion} now={now} busy={busy} error={error} focus={focus} onExpand={onExpand} />;
  }

  return (
    <aside className="focus-rail" aria-label="Focus rail">
      <header className="focus-rail-header">
        <span className="eyebrow focus-eyebrow">
          <Timer size={14} />
          Focus rail
        </span>
        {collapsible && (
          <button className="text-button" onClick={onCollapse}>
            <Shrink size={13} />
            Collapse
          </button>
        )}
      </header>

      <section className="focus-rail-body" aria-label="Focus timer">
        {pendingCompletion ? (
          <CompletionFocusCard
            session={pendingCompletion}
            nextEntry={queueEntries[0] ?? null}
            onQueueAdvanced={prepareQueueAdvance}
          />
        ) : active?.kind === "BREAK" ? (
          <BreakFocusCard
            session={active}
            now={now}
            busy={busy}
            nextTask={queuedTasks[0] ?? null}
            recordedBefore={activities[0] ?? null}
            onQueueChanged={onQueueChanged}
          />
        ) : active?.status === "PAUSED" ? (
          <>
            <PausedFocusCard session={active} now={now} busy={busy} />
            <FocusQueueCard
              session={active}
              tasks={orderedTasks}
              entries={queueEntries}
              projects={projects}
              onQueueTask={onQueueTask}
              onRemoveQueuedTask={onRemoveQueuedTask}
              onReorderQueue={onReorderQueue}
              onBreakQueuePositionChange={setBreakQueuePosition}
              onAnnounce={onAnnounce}
            />
          </>
        ) : active ? (
          <>
            <RunningFocusCard session={active} now={now} busy={busy} />
            <FocusQueueCard
              session={active}
              tasks={orderedTasks}
              entries={queueEntries}
              projects={projects}
              onQueueTask={onQueueTask}
              onRemoveQueuedTask={onRemoveQueuedTask}
              onReorderQueue={onReorderQueue}
              onBreakQueuePositionChange={setBreakQueuePosition}
              onAnnounce={onAnnounce}
            />
          </>
        ) : (
          <FocusSetup
            focus={focus}
            busy={busy}
            retryNextLabel={retryNextLabel}
            preset={preset}
            setPreset={setPreset}
            customMinutes={customMinutes}
            setCustomMinutes={setCustomMinutes}
            taskId={taskId}
            setTaskId={setTaskId}
            setProjectId={setProjectId}
            selectedTask={selectedTask}
            selectedProjectId={selectedProjectId}
            selectedProject={selectedProject}
            taskGroups={taskGroups}
            label={label}
            setLabel={setLabel}
            snapshot={snapshot}
            duration={duration}
            startFocus={startFocus}
            tasks={tasks}
            projects={projects}
          />
        )}

        <CapturedActivities activities={activities} onOpenPalette={onOpenPalette} />

        {error && (
          <p className="form-error focus-error" role="status" aria-live="polite">
            {error}
          </p>
        )}
        {!active && notificationState === "default" && (
          <button
            className="focus-notification-button"
            onClick={() => void focus.requestNotificationPermission()}
          >
            <Bell size={13} />
            Enable completion alert
          </button>
        )}
      </section>
    </aside>
  );
}
