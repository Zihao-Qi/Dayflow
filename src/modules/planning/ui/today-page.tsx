"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pause, Play, Plus, RefreshCw } from "lucide-react";
import { formatLongDate, formatShortDate } from "@/components/dashboard-formatters";
import type { useFocusSession } from "@/components/focus-session-provider";
import { MiniFocusRing, PageHeader } from "@/components/workspace-ui";
import { localDateKey } from "@/lib/dates";
import { focusRemainingSeconds, formatFocusClock } from "@/lib/focus-domain";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { FocusTarget, Task } from "@/modules/planning/ui/backlog-model";
import { TaskRow } from "@/modules/planning/ui/task-row";
import { describeTaskMove, todayHeadline } from "@/modules/planning/ui/today-model";
import type { TodayPageData } from "@/modules/planning/ui/use-today-page";

export type TodayPageProps = TodayPageData & {
  onFocusTransition: ReturnType<typeof useFocusSession>["transition"];
  onAddTask: () => Promise<boolean>;
  newTask: string;
  taskCreatePending: boolean;
  onNewTaskChange: (value: string) => void;
  onUpdateTask: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<boolean>;
  onSaveTaskField: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<boolean>;
  onTaskSaveError: () => void;
  onTaskSaveRecovered: () => void;
  onDeleteTask: (id: string) => Promise<void>;
  onReorderTask: (
    source: string,
    target: string,
    announce?: boolean
  ) => Promise<boolean>;
  onAnnounce: (message: string) => void;
  onStartFocus: (target: FocusTarget) => void;
  onQueueTask: (task: Task, placement: QueuePlacement) => Promise<boolean>;
  onOpenProject: (id: string) => void;
  onOpenBacklog: () => void;
  onLeaveUnfinished: (id: string) => void;
};

export function TodayPage({
  layoutMode,
  today,
  tasks,
  backlogTasks,
  unfinishedTasks,
  projects,
  projectById,
  plannedMinutes,
  focusedMinutes,
  activeFocus,
  focusNow,
  focusBusy,
  onFocusTransition,
  onAddTask,
  newTask,
  taskCreatePending,
  onNewTaskChange,
  onUpdateTask,
  onSaveTaskField,
  onTaskSaveError,
  onTaskSaveRecovered,
  onDeleteTask,
  onReorderTask,
  onAnnounce,
  onStartFocus,
  onQueueTask,
  onOpenProject,
  onOpenBacklog,
  onLeaveUnfinished,
  activities
}: TodayPageProps) {
  const phoneLayout = layoutMode === "phone";
  const open = tasks.filter((task) => task.status !== "DONE");
  const done = tasks.filter((task) => task.status === "DONE");
  const firstCarry = unfinishedTasks[0];
  const [reorderMode, setReorderMode] = useState(false);
  // On a phone the day's own list is the page; Later stays folded away behind
  // it. But with nothing left to act on, these backlog tasks are the only
  // useful content on the screen, so lead with them instead of hiding them.
  //
  // This counts open tasks, not all tasks: `tasks` keeps completed ones, so
  // checking its length would miss the most common way a day empties out —
  // ticking off the last thing on it.
  const nothingLeftToday = open.length === 0;
  const [laterOpen, setLaterOpen] = useState(nothingLeftToday);
  const hadNothingLeft = useRef(nothingLeftToday);
  const reorderButtonRef = useRef<HTMLButtonElement | null>(null);
  const instructionDoneRef = useRef<HTMLButtonElement | null>(null);

  // Completing, deleting or unscheduling the last open task empties the day
  // after mount, so the initial value alone is not enough. Only the transition
  // into empty reopens the section; while it stays empty, a collapse sticks.
  useEffect(() => {
    if (nothingLeftToday && !hadNothingLeft.current) setLaterOpen(true);
    hadNothingLeft.current = nothingLeftToday;
  }, [nothingLeftToday]);

  useEffect(() => {
    if (!reorderMode) return;
    instructionDoneRef.current?.focus();
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setReorderMode(false);
      window.setTimeout(() => reorderButtonRef.current?.focus(), 0);
    }
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [reorderMode]);

  function finishReordering() {
    setReorderMode(false);
    window.setTimeout(() => reorderButtonRef.current?.focus(), 0);
  }

  async function moveTask(task: Task, index: number, direction: -1 | 1) {
    const target = open[index + direction];
    if (!target) return;
    const moved = await onReorderTask(task.id, target.id, false);
    if (!moved) return;
    const nextIndex = index + direction;
    onAnnounce(describeTaskMove(task.title, nextIndex, open.length));
    window.requestAnimationFrame(() => {
      const preferredDirection =
        nextIndex === 0 ? "down" : nextIndex === open.length - 1 ? "up" : direction < 0 ? "up" : "down";
      document
        .querySelector<HTMLButtonElement>(
          `[data-reorder-task="${task.id}"][data-reorder-direction="${preferredDirection}"]`
        )
        ?.focus();
    });
  }

  return (
    <div className="today-page page-stack">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title={todayHeadline(open.length, done.length)}
        actions={
          <div className="today-metrics">
            <span>{plannedMinutes}m planned</span>
            <strong>{focusedMinutes}m done</strong>
          </div>
        }
      />

      {firstCarry && (
        <section className="carry-over-strip">
          <RefreshCw size={15} />
          <p>
            <strong>{firstCarry.title}</strong> was left on{" "}
            {firstCarry.date ? formatShortDate(firstCarry.date) : "an earlier day"}
          </p>
          <div>
            <button
              className="secondary-button focus-button"
              onClick={() =>
                void onUpdateTask(firstCarry.id, {
                  date: localDateKey(new Date(today)),
                  scheduleSource: "unfinished-to-today"
                })
              }
            >
              Do it today
            </button>
            <label className="pick-day-button">
              Pick a day
              <input
                type="date"
                aria-label={`Pick a day for ${firstCarry.title}`}
                onChange={(event) => {
                  if (event.target.value) {
                    void onUpdateTask(firstCarry.id, {
                      date: event.target.value,
                      scheduleSource: "unfinished-date-picker"
                    });
                  }
                }}
              />
            </label>
            <button
              className="text-button"
              onClick={() =>
                void onUpdateTask(firstCarry.id, {
                  date: null,
                  scheduleSource: "unfinished-to-backlog"
                })
              }
            >
              Unschedule
            </button>
            <button className="text-button" onClick={() => onLeaveUnfinished(firstCarry.id)}>
              Leave on {firstCarry.date ? formatShortDate(firstCarry.date) : "that day"}
            </button>
          </div>
        </section>
      )}

      {activeFocus && (
        <section className="today-section now-section">
          <div className="section-heading">
            <span className="eyebrow focus-eyebrow">Now</span>
            <small>
              {activeFocus.status === "PAUSED" ? "paused" : "running"} ·{" "}
              {formatFocusClock(focusRemainingSeconds(activeFocus, focusNow))} left
            </small>
          </div>
          <div className="now-card">
            <MiniFocusRing session={activeFocus} now={focusNow} />
            <div>
              <h2>{activeFocus.task?.title ?? activeFocus.label}</h2>
              <p>
                {[
                  activeFocus.task?.project?.name ?? activeFocus.project?.name,
                  activeFocus.task?.phase?.name,
                  activeFocus.label !== activeFocus.task?.title
                    ? activeFocus.label
                    : null
                ]
                  .filter(Boolean)
                  .join(" · ") || "Independent focus"}
              </p>
            </div>
            <div className="now-actions">
              <button
                className="secondary-button"
                disabled={focusBusy}
                onClick={() =>
                  void onFocusTransition(
                    activeFocus.status === "PAUSED" ? "resume" : "pause"
                  )
                }
              >
                {activeFocus.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}
                {activeFocus.status === "PAUSED" ? "Resume" : "Pause"}
              </button>
              <button
                className="primary-button"
                disabled={focusBusy}
                onClick={() => void onFocusTransition("complete")}
              >
                <Check size={14} />
                Finish
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="today-section next-section">
        <div className="section-heading">
          <span className="eyebrow">Next</span>
          <button
            ref={reorderButtonRef}
            className="text-button"
            aria-pressed={reorderMode}
            onClick={() => {
              if (reorderMode) finishReordering();
              else setReorderMode(true);
            }}
          >
            {reorderMode ? "Done reordering" : "Reorder"}
          </button>
        </div>
        {reorderMode && (
          <div className="reorder-instruction" role="region" aria-label="Reorder tasks">
            <span>
              Reordering. Drag a row, or focus one and press ↑ ↓ to move it.
            </span>
            <button
              ref={instructionDoneRef}
              className="text-button"
              onClick={finishReordering}
            >
              Done
            </button>
          </div>
        )}
        <div className="task-input-row">
          <input
            id="new-task"
            value={newTask}
            onChange={(event) => onNewTaskChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !taskCreatePending) void onAddTask();
            }}
            placeholder="Add a task for today"
          />
          <button
            className="primary-button"
            disabled={taskCreatePending || !newTask.trim()}
            onClick={() => void onAddTask()}
          >
            <Plus size={15} />
            {taskCreatePending ? "Adding…" : "Add"}
          </button>
        </div>
        <div className="task-list">
          {open.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              suggested={
                activeFocus
                  ? task.id === open.find((item) => item.id !== activeFocus.taskId)?.id
                  : index === 0
              }
              project={task.projectId ? projectById.get(task.projectId) : undefined}
              projects={projects}
              reorderMode={reorderMode}
              position={index}
              total={open.length}
              onMove={(direction) => void moveTask(task, index, direction)}
              onUpdate={onUpdateTask}
              onSaveField={onSaveTaskField}
              onSaveError={onTaskSaveError}
              onSaveRecovered={onTaskSaveRecovered}
              onDelete={onDeleteTask}
              onReorder={onReorderTask}
              onOpenProject={onOpenProject}
              onStartFocus={onStartFocus}
              liveSession={Boolean(activeFocus)}
              activeTaskId={activeFocus?.taskId ?? null}
              onQueueTask={onQueueTask}
            />
          ))}
          {!open.length && (
            <div className="quiet-empty">
              <strong>The day is clear.</strong>
              <span>Add one deliberate task when you are ready.</span>
            </div>
          )}
        </div>
      </section>

      {done.length > 0 && (
        <details className="completed-group">
          <summary>Done today · {done.length}</summary>
          <div className="task-list completed-list">
            {done.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                project={task.projectId ? projectById.get(task.projectId) : undefined}
                projects={projects}
                reorderMode={false}
                onUpdate={onUpdateTask}
                onSaveField={onSaveTaskField}
                onSaveError={onTaskSaveError}
                onSaveRecovered={onTaskSaveRecovered}
                onDelete={onDeleteTask}
                onReorder={onReorderTask}
                onOpenProject={onOpenProject}
                onStartFocus={onStartFocus}
                liveSession={Boolean(activeFocus)}
                activeTaskId={activeFocus?.taskId ?? null}
                onQueueTask={onQueueTask}
              />
            ))}
          </div>
        </details>
      )}

      <details
        className="later-section responsive-later-section"
        open={phoneLayout ? laterOpen : true}
        onToggle={(event) => {
          if (phoneLayout) setLaterOpen(event.currentTarget.open);
        }}
      >
        <summary>
          <span className="eyebrow">
            {phoneLayout ? `Later · ${backlogTasks.length}` : "Later · not today"}
          </span>
          {phoneLayout && <small>Bring something into today</small>}
        </summary>
        <div>
          {backlogTasks.slice(0, 5).map((task) => (
            <button
              key={task.id}
              onClick={() =>
                void onUpdateTask(task.id, {
                  date: localDateKey(new Date(today)),
                  scheduleSource: "later-pill"
                })
              }
            >
              {task.title} <strong>+ today</strong>
            </button>
          ))}
          <button className="all-backlog-pill" onClick={onOpenBacklog}>
            {phoneLayout ? "Open backlog" : "All backlog"} · {backlogTasks.length}
          </button>
        </div>
      </details>

      <section className="rail-card captured-card tablet-captured-card">
        <div className="captured-heading">
          <span className="eyebrow">Captured today</span>
          <strong>
            {activities.reduce((sum, activity) => sum + activity.durationMinutes, 0)}m
          </strong>
        </div>
        <div className="captured-list">
          {activities.slice(0, 4).map((activity) => (
            <div key={activity.id}>
              <time>
                {new Date(activity.startedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit"
                })}
              </time>
              <span>
                <strong>{activity.note}</strong>
                <small>{activity.durationMinutes}m · {activity.category}</small>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
