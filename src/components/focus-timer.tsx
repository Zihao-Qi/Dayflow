"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Pause,
  Play,
  Shrink,
  Timer
} from "lucide-react";
import { useFocusSession } from "@/components/focus-session-provider";
import {
  FocusSessionRecord,
  focusElapsedSeconds,
  focusRemainingSeconds,
  formatFocusClock,
  suggestedBreakMinutes
} from "@/lib/focus-domain";
import { ProjectSummary } from "@/lib/project-domain";

type FocusTask = {
  id: string;
  title: string;
  projectId: string | null;
  date: string | null;
  estimateMinutes?: number;
  sortOrder?: number;
};

type CapturedActivity = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
};

export type FocusDraft = {
  revision: number;
  taskId?: string;
  projectId?: string;
  label?: string;
  plannedMinutes?: number;
};

type FocusRailProps = {
  tasks: FocusTask[];
  projects: ProjectSummary[];
  today: string;
  draft: FocusDraft | null;
  activities: CapturedActivity[];
  mode: "full" | "strip";
  collapsible?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onOpenPalette?: () => void;
};

export function FocusRail({
  tasks,
  projects,
  today,
  draft,
  activities,
  mode,
  collapsible = false,
  onCollapse,
  onExpand,
  onOpenPalette
}: FocusRailProps) {
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
  const [preset, setPreset] = useState<"25" | "50" | "custom">("25");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [selectionInitialized, setSelectionInitialized] = useState(false);

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
        const aToday = a.date?.slice(0, 10) === todayKey ? 0 : 1;
        const bToday = b.date?.slice(0, 10) === todayKey ? 0 : 1;
        return aToday - bToday || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      }),
    [tasks, todayKey]
  );

  useEffect(() => {
    if (selectionInitialized || active || draft) return;
    const nextTask = orderedTasks[0];
    if (nextTask) {
      setTaskId(nextTask.id);
      setProjectId("");
    }
    setSelectionInitialized(true);
  }, [active, draft, orderedTasks, selectionInitialized]);
  const duration = preset === "custom" ? Number(customMinutes) : Number(preset);
  const queuedTasks = orderedTasks
    .filter((task) => task.id !== (active?.taskId ?? pendingCompletion?.taskId))
    .slice(0, 2);

  async function startFocus() {
    await focus.start({
      kind: "FOCUS",
      plannedMinutes: duration,
      label,
      taskId: taskId || null,
      projectId: !selectedTask?.projectId ? projectId || null : null
    });
  }

  if (mode === "strip") {
    const live = active ?? pendingCompletion;
    if (!live) return null;
    const completionPending = Boolean(pendingCompletion && !active);
    const isBreak = active?.kind === "BREAK";
    const isPaused = active?.status === "PAUSED";
    const remaining = active ? focusRemainingSeconds(active, now) : 0;
    const elapsed = active ? focusElapsedSeconds(active, now) : 0;
    const progress = active
      ? Math.min(100, (elapsed / (active.plannedMinutes * 60)) * 100)
      : 100;
    return (
      <aside
        className={`focus-strip ${isBreak ? "break" : ""} ${isPaused ? "paused" : ""} ${completionPending ? "complete" : ""}`}
        aria-label={completionPending ? "Completed focus session" : "Active focus session"}
      >
        <button
          className="focus-strip-ring"
          title="Expand focus rail"
          onClick={onExpand}
          style={{
            background: completionPending
              ? "var(--sage)"
              : `conic-gradient(${isBreak || isPaused ? "#c9a882" : "var(--sage)"} ${progress}%, ${isBreak || isPaused ? "#e6ddcb" : "#e2e0d5"} ${progress}% 100%)`
          }}
        >
          <span>
            {completionPending ? <Check size={16} /> : formatFocusClock(remaining)}
          </span>
        </button>
        <button className="focus-strip-mobile-copy" onClick={onExpand}>
          <strong>{live.task?.title ?? live.label}</strong>
          <span>
            {completionPending
              ? `${live.actualMinutes}m done · add the record`
              : isBreak
                ? `Break · ${formatFocusClock(remaining)} left`
                : isPaused
                  ? `Paused · ${formatFocusClock(remaining)} left`
                : `Focusing · ${formatFocusClock(remaining)} left`}
          </span>
        </button>
        <span className="focus-strip-label">
          {completionPending ? "Done" : isBreak ? "Break" : isPaused ? "Paused" : "Focus"}
        </span>
        {!completionPending && active && (
          <>
            <button
              className="focus-strip-action"
              title={active.status === "PAUSED" ? "Resume timer" : "Pause timer"}
              aria-label={active.status === "PAUSED" ? "Resume timer" : "Pause timer"}
              disabled={busy}
              onClick={() =>
                void focus.transition(active.status === "PAUSED" ? "resume" : "pause")
              }
            >
              {active.status === "PAUSED" ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              className="focus-strip-action finish"
              title={isBreak ? "End break" : "Finish timer"}
              aria-label={isBreak ? "End break" : "Finish timer"}
              disabled={busy}
              onClick={() => void focus.transition("complete")}
            >
              <Check size={15} />
            </button>
          </>
        )}
        {completionPending && (
          <button
            className="focus-strip-action finish"
            title="Add completion record"
            aria-label="Add completion record"
            onClick={onExpand}
          >
            <Check size={15} />
          </button>
        )}
        <button
          className="focus-strip-expand"
          title="Expand focus rail"
          aria-label="Expand focus rail"
          onClick={onExpand}
        >
          <ChevronDown size={16} />
        </button>
        {error && <span className="sr-only">{error}</span>}
      </aside>
    );
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
          <CompletionFocusCard session={pendingCompletion} />
        ) : active?.kind === "BREAK" ? (
          <BreakFocusCard
            session={active}
            now={now}
            busy={busy}
            nextTask={queuedTasks[0] ?? null}
            recordedBefore={activities[0] ?? null}
          />
        ) : active?.status === "PAUSED" ? (
          <PausedFocusCard session={active} now={now} busy={busy} />
        ) : active ? (
          <>
            <RunningFocusCard session={active} now={now} busy={busy} />
            <section className="rail-card focus-queue-card">
              <span className="eyebrow">Queue after this</span>
              <div className="focus-queue">
                <div>
                  <time>5m</time>
                  <span>
                    <strong>Break</strong>
                    <small>Stand up</small>
                  </span>
                </div>
                {queuedTasks.map((task) => (
                  <div key={task.id}>
                    <time>{task.estimateMinutes || 25}m</time>
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {task.projectId
                          ? projects.find((project) => project.id === task.projectId)?.name
                          : "Next planned task"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
              <small className="queue-derived-note">Derived from your day plan</small>
            </section>
          </>
        ) : (
          <section className="rail-card focus-idle-card">
            <span className="eyebrow">Start a block</span>
            <div className="focus-presets" aria-label="Focus duration">
              <button
                className={preset === "25" ? "active" : ""}
                aria-pressed={preset === "25"}
                aria-label="25 minutes, 5 minute break"
                onClick={() => setPreset("25")}
              >
                <strong>25</strong>
                <span>5m break</span>
              </button>
              <button
                className={preset === "50" ? "active" : ""}
                aria-pressed={preset === "50"}
                aria-label="50 minutes, 10 minute break"
                onClick={() => setPreset("50")}
              >
                <strong>50</strong>
                <span>10m break</span>
              </button>
              <button
                className={preset === "custom" ? "active" : ""}
                aria-pressed={preset === "custom"}
                aria-label="Custom focus duration"
                onClick={() => setPreset("custom")}
              >
                <strong>Custom</strong>
                <span>1–240m</span>
              </button>
            </div>
            {preset === "custom" && (
              <label className="rail-field">
                Focus minutes
                <input
                  aria-label="Custom focus minutes"
                  type="number"
                  min="1"
                  max="240"
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                />
              </label>
            )}
            <label className="rail-field">
              Working on
              <select
                aria-label="Focus task"
                value={taskId}
                onChange={(event) => {
                  setTaskId(event.target.value);
                  if (tasks.find((task) => task.id === event.target.value)?.projectId) {
                    setProjectId("");
                  }
                }}
              >
                <option value="">Choose a task or focus freely</option>
                {orderedTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            {!selectedTask?.projectId && (
              <label className="rail-field rail-project-field">
                Project
                <select
                  aria-label="Focus project"
                  value={selectedProjectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">No project</option>
                  {projects
                    .filter((project) => project.status === "ACTIVE")
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {selectedTask?.projectId && selectedProject && (
              <p className="rail-inherited">Project · {selectedProject.name}</p>
            )}
            <label className="rail-field">
              Intention
              <input
                value={label}
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="What will you move forward?"
              />
            </label>
            <button
              className="primary-button focus-start-button"
              disabled={busy || !snapshot}
              onClick={() => void startFocus()}
            >
              <Play size={15} />
              Start {Number.isFinite(duration) ? duration : ""}m focus
            </button>
            <small className="focus-shortcut">⌘⇧F starts from anywhere</small>
          </section>
        )}

        <section className="rail-card captured-card">
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
                  <small>
                    {activity.durationMinutes}m · {activity.category}
                  </small>
                </span>
              </div>
            ))}
            {!activities.length && (
              <p>No activity recorded yet. Your completed focus blocks will appear here.</p>
            )}
          </div>
          <button className="rail-link" onClick={onOpenPalette}>
            Log something by hand
          </button>
        </section>

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

function CompletionFocusCard({ session }: { session: FocusSessionRecord }) {
  const focus = useFocusSession();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("Deep Work");
  const [taskCompleted, setTaskCompleted] = useState(Boolean(session.taskId));
  const suggestedBreak = suggestedBreakMinutes(session.plannedMinutes);

  async function save(takeBreak: boolean) {
    await focus.recordCompletion({
      note,
      category,
      taskCompleted,
      takeBreak
    });
  }

  return (
    <section className="rail-card completion-focus-card">
      <div className="completion-sheet-heading">
        <div className="completion-mark">
          <Check size={21} />
        </div>
        <div>
          <h3>{session.actualMinutes}m done</h3>
          <p>{session.task?.title ?? session.label}</p>
        </div>
      </div>
      <label className="completion-note">
        What moved forward?
        <textarea
          aria-label="Completion note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="One line is enough — it becomes today’s activity record."
        />
      </label>
      <fieldset className="completion-categories">
        <legend>Category</legend>
        <div>
          {["Deep Work", "Learning", "Admin"].map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? "active" : ""}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
      {session.taskId && (
        <section className="completion-task-question">
          <span>Was the task itself finished?</span>
          <div>
            <button
              className={taskCompleted ? "primary-button" : "secondary-button"}
              onClick={() => setTaskCompleted(true)}
            >
              Mark done
            </button>
            <button
              className={!taskCompleted ? "secondary-button active" : "secondary-button"}
              onClick={() => setTaskCompleted(false)}
            >
              Still going
            </button>
          </div>
        </section>
      )}
      <button
        className="secondary-button completion-save-break"
        disabled={focus.busy || (session.actualMinutes >= 1 && !note.trim())}
        onClick={() => void save(true)}
      >
        Save and take a {suggestedBreak}m break
      </button>
      <button
        className="text-button completion-keep-working"
        disabled={focus.busy || (session.actualMinutes >= 1 && !note.trim())}
        onClick={() => void save(false)}
      >
        Save and keep working
      </button>
      <small className="completion-required-note">
        {note.trim()
          ? `${session.actualMinutes}m is already safe`
          : `One line is required — ${session.actualMinutes}m is already safe`}
      </small>
    </section>
  );
}

function BreakFocusCard({
  session,
  now,
  busy,
  nextTask,
  recordedBefore
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
  nextTask: FocusTask | null;
  recordedBefore: CapturedActivity | null;
}) {
  const focus = useFocusSession();
  const remaining = focusRemainingSeconds(session, now);
  const elapsed = focusElapsedSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);

  async function startNext() {
    const completed = await focus.transition("complete");
    if (!completed || !nextTask) return;
    await focus.start({
      kind: "FOCUS",
      plannedMinutes: nextTask.estimateMinutes || 25,
      taskId: nextTask.id,
      label: nextTask.title
    });
  }

  return (
    <section className="rail-card break-focus-card">
      <span className="break-kicker">Recovery · nothing recorded</span>
      <h3>Break</h3>
      <div
        className="rail-focus-clock"
        style={{
          background: `conic-gradient(var(--clay) ${progress}%, #e6ddcb ${progress}% 100%)`
        }}
      >
        <div>
          <strong>{formatFocusClock(remaining)}</strong>
          <span>{session.plannedMinutes}m</span>
        </div>
      </div>
      <p>
        Stand up and look away from the screen. Nothing is being recorded.
      </p>
      <div className="rail-focus-controls">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void focus.transition("complete")}
        >
          End break
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void startNext()}
        >
          Start next
        </button>
      </div>
      <section className="break-recorded-before">
        <span className="eyebrow">Recorded before this</span>
        {recordedBefore ? (
          <strong>
            {recordedBefore.note} · {recordedBefore.durationMinutes}m
          </strong>
        ) : (
          <strong>Your completed focus block is safe in Log.</strong>
        )}
      </section>
      {nextTask && <footer><span className="eyebrow">Up next</span><strong>{nextTask.title} · {nextTask.estimateMinutes || 25}m</strong></footer>}
    </section>
  );
}

function PausedFocusCard({
  session,
  now,
  busy
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
}) {
  const { transition } = useFocusSession();
  const elapsed = focusElapsedSeconds(session, now);
  const remaining = focusRemainingSeconds(session, now);
  const elapsedMinutes = Math.floor(elapsed / 60);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  const pausedSeconds = session.pausedAt
    ? Math.max(0, Math.floor((now - new Date(session.pausedAt).getTime()) / 1000))
    : 0;
  const pausedFor =
    pausedSeconds < 60
      ? "just now"
      : pausedSeconds < 3600
        ? `${Math.floor(pausedSeconds / 60)} ${Math.floor(pausedSeconds / 60) === 1 ? "minute" : "minutes"} ago`
        : pausedSeconds < 86400
          ? `${Math.floor(pausedSeconds / 3600)} ${Math.floor(pausedSeconds / 3600) === 1 ? "hour" : "hours"} ago`
          : `${Math.floor(pausedSeconds / 86400)} ${Math.floor(pausedSeconds / 86400) === 1 ? "day" : "days"} ago`;
  const title = session.task?.title ?? session.label;

  return (
    <>
      <section className="rail-card paused-focus-card">
        <div
          className="rail-focus-clock"
          style={{
            background: `conic-gradient(#c9a882 ${progress}%, #e6ddcb ${progress}% 100%)`
          }}
          aria-label={`${formatFocusClock(remaining)} remaining while paused`}
        >
          <div>
            <strong>{formatFocusClock(remaining)}</strong>
            <span>Paused · {session.plannedMinutes}m</span>
          </div>
        </div>
        <h3>{title}</h3>
        <p>
          Paused {pausedFor}. Nothing is being recorded.
        </p>
        <div className="rail-focus-controls">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void transition("resume")}
          >
            <Play size={14} />
            Resume
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void transition("complete")}
          >
            Finish {elapsedMinutes}m
          </button>
        </div>
        <button
          className="text-button rail-cancel"
          disabled={busy}
          onClick={() => {
            if (
              elapsedMinutes < 1 ||
              window.confirm(
                `Cancel this focus block? ${elapsedMinutes}m of focus will not be recorded.`
              )
            ) {
              void transition("cancel");
            }
          }}
        >
          Cancel
        </button>
      </section>
      <section className="rail-card paused-recorded-card">
        <span className="eyebrow">Already recorded</span>
        <p>
          {elapsedMinutes}m of this block is safe. Finishing now keeps it.
        </p>
      </section>
    </>
  );
}

function RunningFocusCard({
  session,
  now,
  busy
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
}) {
  const { transition } = useFocusSession();
  const elapsed = focusElapsedSeconds(session, now);
  const remaining = focusRemainingSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  const association =
    session.task?.project?.name ??
    session.project?.name ??
    (session.kind === "BREAK" ? "Recovery" : "Independent focus");
  const title = session.task?.title ?? session.label;
  const context = [
    association,
    session.task?.phase?.name,
    session.label !== session.task?.title ? session.label : null
  ]
    .filter(Boolean)
    .join(" · ");
  const finishAt = new Date(
    now + remaining * 1000
  ).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const elapsedMinutes = Math.floor(elapsed / 60);

  return (
    <section className="rail-card running-focus-card">
      <div
        className="rail-focus-clock"
        style={{
          background: `conic-gradient(var(--sage) ${progress}%, #e2e0d5 ${progress}% 100%)`
        }}
        aria-label={`${formatFocusClock(remaining)} remaining`}
      >
        <div>
          <strong>{formatFocusClock(remaining)}</strong>
          <span>
            {session.status === "PAUSED"
              ? "Paused"
              : session.kind === "BREAK"
                ? "Break"
                : `Focus · ${session.plannedMinutes}m`}
          </span>
        </div>
      </div>
      <h3>{title}</h3>
      <p className="running-association">{context}</p>
      <p className="completion-alert">Recording. One alert at {finishAt}.</p>
      <div className="rail-focus-controls">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void transition(session.status === "PAUSED" ? "resume" : "pause")
          }
        >
          {session.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}
          {session.status === "PAUSED" ? "Resume" : "Pause"}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void transition("complete")}
        >
          <Check size={14} />
          Finish
        </button>
      </div>
      <button
        className="text-button danger-text rail-cancel"
        disabled={busy}
        onClick={() => {
          if (
            elapsedMinutes < 1 ||
            window.confirm(
              `Cancel this focus block? ${elapsedMinutes}m of focus will not be recorded.`
            )
          ) {
            void transition("cancel");
          }
        }}
      >
        {session.kind === "FOCUS" && elapsedMinutes > 0
          ? `Cancel — ${elapsedMinutes}m won’t be recorded`
          : "Cancel"}
      </button>
    </section>
  );
}

/**
 * Kept as a compatibility wrapper for consumers that previously mounted the timer
 * as a panel. The redesigned app shell mounts FocusRail instead.
 */
export function FocusTimer({
  tasks,
  projects,
  today,
  draft
}: {
  tasks: FocusTask[];
  projects: ProjectSummary[];
  today: string;
  draft: FocusDraft | null;
}) {
  return (
    <FocusRail
      tasks={tasks}
      projects={projects}
      today={today}
      draft={draft}
      activities={[]}
      mode="full"
    />
  );
}

export function FocusSessionBanner({ onOpenToday }: { onOpenToday: () => void }) {
  const { active } = useFocusSession();
  if (!active) return null;
  return (
    <FocusRail
      tasks={[]}
      projects={[]}
      today={new Date().toISOString()}
      draft={null}
      activities={[]}
      mode="strip"
      onExpand={onOpenToday}
    />
  );
}
