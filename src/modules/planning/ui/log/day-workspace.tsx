"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import {
  MiniFocusRing,
  PageHeader,
  SegmentedControl
} from "@/components/workspace-ui";
import {
  formatActivityTime,
  formatClockTime,
  formatLongDate,
  formatLongLocalDateKey,
  formatMinutes
} from "@/components/dashboard-formatters";
import {
  formatTimelineHour,
  safeTimeBlockDurationMinutes,
  safeTimeBlockInterval,
  timelineBounds,
  timelineHourHeights,
  timelinePosition
} from "@/modules/planning/ui/log/day-workspace-helpers";
import type { ViewedDayKind } from "@/lib/day-records";
import type { FocusSessionRecord } from "@/lib/focus-domain";
import {
  focusElapsedSeconds,
  focusRemainingSeconds,
  formatFocusClock
} from "@/lib/focus-domain";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { ProjectSummary } from "@/lib/project-domain";
import type { TimeBlockRecord } from "@/lib/time-blocks";

type DayView = "stream" | "timeline";
type FocusTarget = {
  taskId?: string;
  projectId?: string;
  label?: string;
  plannedMinutes?: number;
};
type FocusTransition = (
  action: "pause" | "resume" | "complete" | "cancel"
) => Promise<boolean>;
type Task = {
  id: string;
  title: string;
  date: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  focusQueuePosition: number | null;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};
type ActivityEntry = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  origin: "MANUAL" | "FOCUS";
  taskId: string | null;
  projectId: string | null;
  attributedProjectId: string | null;
  focusSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};
type TimeBlock = TimeBlockRecord;

export function DayPage({
  view,
  today,
  todayKey,
  dayKey,
  dayKind,
  earliestDayKey,
  forwardWeeks,
  dayLoading,
  dayReady,
  dayError,
  onRetry,
  onChangeDay,
  onGoToToday,
  tasks,
  activities,
  timeBlocks,
  projects,
  blockedMinutes,
  recordedMinutes,
  noteCount,
  activeFocus,
  focusNow,
  focusBusy,
  onViewChange,
  onStartFocus,
  onQueueTask,
  onFocusTransition,
  onOpenPalette,
  onCreateTimeBlock,
  onEditTimeBlock,
  onEditActivity
}: {
  view: DayView;
  today: string;
  todayKey: string;
  dayKey: string;
  dayKind: ViewedDayKind;
  earliestDayKey: string | null;
  forwardWeeks: number;
  dayLoading: boolean;
  dayReady: boolean;
  dayError: string;
  onRetry: () => void;
  onChangeDay: (dayKey: string) => void;
  onGoToToday: () => void;
  tasks: Task[];
  activities: ActivityEntry[];
  timeBlocks: TimeBlock[];
  projects: Map<string, ProjectSummary>;
  blockedMinutes: number;
  recordedMinutes: number;
  noteCount: number;
  activeFocus: FocusSessionRecord | null;
  focusNow: number;
  focusBusy: boolean;
  onViewChange: (view: DayView) => void;
  onStartFocus: (target: FocusTarget) => void;
  onQueueTask: (task: Task, placement: QueuePlacement) => Promise<boolean>;
  onFocusTransition: FocusTransition;
  onOpenPalette: () => void;
  onCreateTimeBlock: (date: string, task?: Task | null) => void;
  onEditTimeBlock: (block: TimeBlock) => void;
  onEditActivity: (activity: ActivityEntry) => void;
}) {
  const isToday = dayKind === "today";
  const isFuture = dayKind === "future";

  return (
    <div className="day-page log-page page-stack">
      <PageHeader
        eyebrow={
          isToday
            ? formatLongDate(today)
            : `${isFuture ? "Planning" : "Looking back"} · ${formatLongLocalDateKey(dayKey)}`
        }
        title="Log"
        actions={
          <SegmentedControl
            ariaLabel="Log view"
            value={view}
            options={[
              ["stream", "Stream"],
              ["timeline", "Timeline"]
            ]}
            onChange={onViewChange}
          />
        }
      />

      <DayPicker
        dayKey={dayKey}
        todayKey={todayKey}
        earliestDayKey={earliestDayKey}
        forwardWeeks={forwardWeeks}
        loading={dayLoading}
        onChangeDay={onChangeDay}
        onGoToToday={onGoToToday}
      />

      {dayError && (
        <p className="day-error" role="alert">
          {dayError}
          <button className="secondary-button" onClick={onRetry}>Retry day</button>
        </p>
      )}

      {dayReady && <>
      {isFuture ? (
        <div className="log-totals" aria-label="Planned totals">
          <strong>{formatMinutes(blockedMinutes)} planned</strong>
          <span>
            {timeBlocks.length} {timeBlocks.length === 1 ? "block" : "blocks"} ·{" "}
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} scheduled
          </span>
          <small>nothing recorded yet — this day has not happened</small>
        </div>
      ) : (
        <div
          className="log-totals"
          aria-label={isToday ? "Today’s log totals" : "Log totals for this day"}
        >
          <span>{formatMinutes(blockedMinutes)} planned</span>
          <strong>{formatMinutes(recordedMinutes)} recorded</strong>
          <span>
            {activities.length} {activities.length === 1 ? "session" : "sessions"}
            {isToday ? ` · ${noteCount} ${noteCount === 1 ? "note" : "notes"}` : ""}
          </span>
          <small>{isToday ? "so far today" : "on this day"}</small>
        </div>
      )}
      {view === "stream" && (
        <DayStream
          tasks={tasks}
          activities={activities}
          projects={projects}
          activeFocus={isToday ? activeFocus : null}
          focusNow={focusNow}
          focusBusy={focusBusy}
          onStartFocus={isToday ? onStartFocus : undefined}
          onQueueTask={isToday ? onQueueTask : undefined}
          onFocusTransition={isToday ? onFocusTransition : undefined}
          onOpenPalette={isToday ? onOpenPalette : undefined}
          onEditActivity={isFuture ? undefined : onEditActivity}
        />
      )}
      {view === "timeline" && (
        <DayTimeline
          todayKey={dayKey}
          blocks={timeBlocks}
          tasks={tasks}
          activities={activities}
          activeFocus={isToday ? activeFocus : null}
          focusNow={focusNow}
          onCreateBlock={
            dayKind === "past"
              ? undefined
              : (task) => onCreateTimeBlock(dayKey, task)
          }
          onEditBlock={onEditTimeBlock}
        />
      )}
      </>}
    </div>
  );
}

function shiftDayKey(dayKey: string, days: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(year, month - 1, day + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(
    shifted.getDate()
  ).padStart(2, "0")}`;
}

function DayPicker({
  dayKey,
  todayKey,
  earliestDayKey,
  forwardWeeks,
  loading,
  onChangeDay,
  onGoToToday
}: {
  dayKey: string;
  todayKey: string;
  earliestDayKey: string | null;
  forwardWeeks: number;
  loading: boolean;
  onChangeDay: (dayKey: string) => void;
  onGoToToday: () => void;
}) {
  const horizonKey = shiftDayKey(todayKey, forwardWeeks * 7);
  // There is nothing to read before the earliest record, and nothing to plan
  // past the horizon. Both ends stop rather than silently landing elsewhere.
  const atStart = Boolean(earliestDayKey) && dayKey <= (earliestDayKey ?? "");
  const atEnd = dayKey >= horizonKey;

  return (
    <div className="day-picker" role="group" aria-label="Choose a day">
      <button
        type="button"
        className="secondary-button"
        aria-label="Previous day"
        disabled={loading || atStart}
        onClick={() => onChangeDay(shiftDayKey(dayKey, -1))}
      >
        <ChevronLeft size={15} />
      </button>
      <label className="day-picker-date">
        <input
          type="date"
          aria-label="Day shown in Log"
          value={dayKey}
          max={horizonKey}
          min={earliestDayKey ?? undefined}
          disabled={loading}
          onChange={(event) => {
            if (event.target.value) onChangeDay(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        aria-label="Next day"
        disabled={loading || atEnd}
        onClick={() => onChangeDay(shiftDayKey(dayKey, 1))}
      >
        <ChevronRight size={15} />
      </button>
      {dayKey !== todayKey && (
        <button
          type="button"
          className="text-button"
          disabled={loading}
          onClick={onGoToToday}
        >
          Back to today
        </button>
      )}
      {loading && (
        <small role="status" className="day-picker-status">
          Loading…
        </small>
      )}
    </div>
  );
}

function DayStream({
  tasks,
  activities,
  projects,
  activeFocus,
  focusNow,
  focusBusy,
  onStartFocus,
  onQueueTask,
  onFocusTransition,
  onOpenPalette,
  onEditActivity
}: {
  tasks: Task[];
  activities: ActivityEntry[];
  projects: Map<string, ProjectSummary>;
  activeFocus: FocusSessionRecord | null;
  focusNow: number;
  focusBusy: boolean;
  onStartFocus?: (target: FocusTarget) => void;
  onQueueTask?: (task: Task, placement: QueuePlacement) => Promise<boolean>;
  onFocusTransition?: FocusTransition;
  onOpenPalette?: () => void;
  onEditActivity?: (activity: ActivityEntry) => void;
}) {
  const canAct = Boolean(onStartFocus && onQueueTask && onOpenPalette);
  let cursor = new Date();
  const idleNext = canAct && !activeFocus ? tasks[0] ?? null : null;
  const plannedTasks = canAct
    ? activeFocus
      ? tasks.filter((task) => task.id !== activeFocus.taskId)
      : tasks.slice(1)
    : tasks;
  // The marker only means something once there is something on one side of
  // it. On an empty day the sentence explains a diagram that isn't drawn yet.
  const hasEntries = activities.length > 0 || tasks.length > 0;
  return (
    <section className="day-view">
      {hasEntries && (
        <p className="view-explainer">
          {canAct
            ? "Above the marker is what happened. Below it is what is still planned — that part you can still change."
            : "Recorded activity and scheduled work for this day are shown without present-time actions."}
        </p>
      )}
      <div className="day-stream">
        {[...activities].reverse().map((activity) => {
          const projectId =
            activity.attributedProjectId ?? activity.projectId;
          return (
            <article className="stream-row complete" key={activity.id}>
              <time>{formatActivityTime(activity.startedAt)}</time>
              <div>
                <i />
                <div className="stream-activity-heading">
                  <strong>
                    {activity.durationMinutes}m · {activity.category}
                  </strong>
                  {onEditActivity &&
                    activity.origin === "MANUAL" &&
                    activity.focusSessionId === null && (
                      <button
                        aria-label={`Edit activity: ${activity.note}`}
                        className="stream-activity-edit"
                        onClick={() => onEditActivity?.(activity)}
                        type="button"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                    )}
                </div>
                <p>{activity.note}</p>
                {projectId && projects.get(projectId) && (
                  <span>{projects.get(projectId)?.name}</span>
                )}
              </div>
            </article>
          );
        })}
        {activeFocus && (
          <article className="stream-row now">
            <time>now</time>
            <div>
              <i />
              <section className="stream-now-card">
                <MiniFocusRing session={activeFocus} now={focusNow} />
                <span>
                  <strong>{activeFocus.label}</strong>
                  <small>{formatFocusClock(focusRemainingSeconds(activeFocus, focusNow))} left</small>
                </span>
                <button
                  className="secondary-button"
                  disabled={focusBusy}
                  onClick={() =>
                    void onFocusTransition?.(
                      activeFocus.status === "PAUSED" ? "resume" : "pause"
                    )
                  }
                >
                  {activeFocus.status === "PAUSED" ? "Resume" : "Pause"}
                </button>
                <button
                  className="primary-button"
                  disabled={focusBusy}
                  onClick={() => void onFocusTransition?.("complete")}
                >
                  Finish
                </button>
              </section>
            </div>
          </article>
        )}
        {idleNext && (
          <article className="stream-row now idle-now">
            <time>now</time>
            <div>
              <i />
              <section className="stream-task-card">
                <span>
                  <strong>Nothing running · {tasks.length} tasks left</strong>
                  <small>{idleNext.title} · {idleNext.estimateMinutes}m</small>
                </span>
                <button
                  className="secondary-button"
                  onClick={() =>
                    onStartFocus?.({
                      taskId: idleNext.id,
                      projectId: idleNext.projectId ?? undefined,
                      label: idleNext.title,
                      plannedMinutes: idleNext.estimateMinutes
                    })
                  }
                >
                  Start this block
                </button>
              </section>
            </div>
          </article>
        )}
        {plannedTasks.slice(0, 4).map((task, index) => {
          if (index > 0) {
            cursor = new Date(
              cursor.getTime() + plannedTasks[index - 1].estimateMinutes * 60000
            );
          }
          return (
            <article className="stream-row planned" key={task.id}>
              <time>{index === 0 ? "still planned" : `≈ ${formatClockTime(cursor)}`}</time>
              <div>
                <i />
                <section className="stream-task-card">
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.estimateMinutes}m
                      {task.projectId && projects.get(task.projectId)
                        ? ` · ${projects.get(task.projectId)?.name}`
                        : ""}
                    </small>
                  </span>
                  {canAct && (
                    <button
                      className={
                        activeFocus
                          ? "plain-button queue-next-button"
                          : index === 0
                            ? "secondary-button"
                            : "plain-button"
                      }
                      disabled={Boolean(
                        activeFocus && task.focusQueuePosition !== null
                      )}
                      onClick={() =>
                        activeFocus
                          ? void onQueueTask?.(
                              task,
                              index === 0 ? "next" : "end"
                            )
                          : onStartFocus?.({
                              taskId: task.id,
                              projectId: task.projectId ?? undefined,
                              label: task.title,
                              plannedMinutes: task.estimateMinutes
                            })
                      }
                    >
                      {activeFocus && task.focusQueuePosition === null && (
                        <Plus size={12} />
                      )}
                      {activeFocus
                        ? task.focusQueuePosition !== null
                          ? "Queued"
                          : index === 0
                            ? "Queue next"
                            : "Queue"
                        : index === 0
                          ? "Focus next"
                          : "Focus"}
                    </button>
                  )}
                </section>
              </div>
            </article>
          );
        })}
        {onOpenPalette && (
          <article className="stream-row planned add">
            <time />
            <div>
              <i />
              <button onClick={onOpenPalette}>
                Add to the day<span className="desktop-shortcut"> · ⌘K</span>
              </button>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function DayTimeline({
  todayKey,
  blocks,
  tasks,
  activities,
  activeFocus,
  focusNow,
  onCreateBlock,
  onEditBlock
}: {
  todayKey: string;
  blocks: TimeBlock[];
  tasks: Task[];
  activities: ActivityEntry[];
  activeFocus: FocusSessionRecord | null;
  focusNow: number;
  onCreateBlock?: (task?: Task | null) => void;
  onEditBlock: (block: TimeBlock) => void;
}) {
  const todayBlocks = blocks
    .filter((block) => block.date === todayKey)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.endTime.localeCompare(right.endTime) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
  const bounds = timelineBounds(todayBlocks, activities, activeFocus, focusNow);
  const timelineScales = timelineHourHeights(todayBlocks);
  const timelineStyle = {
    "--timeline-desktop-hour-height": `${timelineScales.desktop}px`,
    "--timeline-touch-hour-height": `${timelineScales.touch}px`,
    "--timeline-desktop-height": `${
      bounds.hourCount * timelineScales.desktop
    }px`,
    "--timeline-touch-height": `${
      bounds.hourCount * timelineScales.touch
    }px`
  } as CSSProperties;
  return (
    <section className="day-view">
      <p className="view-explainer">
        Planned time and focused time share one grid so gaps and overages stay honest.
      </p>
      <div className="timeline-planning-toolbar">
        <div>
          <span className="eyebrow">Manual plan</span>
          <strong>
            {todayBlocks.length
              ? `${todayBlocks.length} ${
                  todayBlocks.length === 1 ? "block" : "blocks"
                } · ${formatMinutes(
                  todayBlocks.reduce(
                    (sum, block) =>
                      sum + safeTimeBlockDurationMinutes(block),
                    0
                  )
                )}`
              : "No time blocks yet"}
          </strong>
        </div>
        {onCreateBlock && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => onCreateBlock(null)}
        >
          <Plus size={14} />
          Add time block
        </button>
        )}
      </div>
      {onCreateBlock && tasks.length > 0 && (
        <div className="timeline-task-shortcuts" aria-label="Block a task">
          <span>Block a task</span>
          <div>
            {tasks.map((task) => (
              <button
                aria-label={`Block time for ${task.title}`}
                key={task.id}
                onClick={() => onCreateBlock(task)}
                type="button"
              >
                <span>{task.title}</span>
                <small>{task.estimateMinutes || 30}m</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="day-timeline-scroll">
        <div className="day-timeline-panel" style={timelineStyle}>
          <div className="timeline-corner" />
          <span className="timeline-column-label">Planned</span>
          <span className="timeline-column-label focused">Focused</span>
          <div className="timeline-hours">
            {Array.from({ length: bounds.hourCount }, (_, index) => (
              <span key={index}>
                {formatTimelineHour(index + bounds.startHour)}
              </span>
            ))}
          </div>
          <div className="timeline-column">
            {todayBlocks.map((block) => {
              const interval = safeTimeBlockInterval(block);
              if (!interval) return null;
              return (
                <button
                  aria-label={`Time block: ${block.title}, ${block.startTime} to ${block.endTime}`}
                  className="planned-block"
                  key={block.id}
                  onClick={() => onEditBlock(block)}
                  style={timelinePosition(
                    interval.startMinutes,
                    interval.endMinutes - interval.startMinutes,
                    bounds.startHour,
                    bounds.hourCount
                  )}
                  type="button"
                >
                  <strong>{block.title}</strong>
                  <small>
                    {block.startTime}–{block.endTime}
                  </small>
                </button>
              );
            })}
            {!todayBlocks.length && onCreateBlock && (
              <button
                className="timeline-empty"
                onClick={() => onCreateBlock(null)}
                style={timelinePosition(
                  Math.max(9, bounds.startHour) * 60,
                  60,
                  bounds.startHour,
                  bounds.hourCount
                )}
                type="button"
              >
                Nothing planned · add a block
              </button>
            )}
            {!todayBlocks.length && !onCreateBlock && (
              <p className="timeline-empty-note">Nothing was planned for this day.</p>
            )}
          </div>
          <div className="timeline-column actual">
            {activities.map((activity) => {
              const date = new Date(activity.startedAt);
              const start = date.getHours() * 60 + date.getMinutes();
              return (
                <article
                  className="focused-block"
                  key={activity.id}
                  style={timelinePosition(
                    start,
                    activity.durationMinutes,
                    bounds.startHour,
                    bounds.hourCount
                  )}
                >
                  <strong>{activity.note}</strong>
                  <small>{activity.durationMinutes}m</small>
                </article>
              );
            })}
            {activeFocus && (
              <article
                className="focused-block running"
                style={timelinePosition(
                  new Date(activeFocus.startedAt).getHours() * 60 +
                    new Date(activeFocus.startedAt).getMinutes(),
                  Math.max(
                    20,
                    Math.floor(
                      focusElapsedSeconds(activeFocus, focusNow) / 60
                    )
                  ),
                  bounds.startHour,
                  bounds.hourCount
                )}
              >
                <strong>{activeFocus.label}</strong>
                <small>running</small>
              </article>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
