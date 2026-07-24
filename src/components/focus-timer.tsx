"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  Coffee,
  Pause,
  Play,
  RotateCcw,
  Timer,
  X
} from "lucide-react";
import { useFocusSession } from "@/components/focus-session-provider";
import {
  FocusSessionRecord,
  focusElapsedSeconds,
  focusRemainingSeconds,
  formatFocusClock
} from "@/lib/focus-domain";
import { ProjectSummary } from "@/lib/project-domain";

type FocusTask = {
  id: string;
  title: string;
  projectId: string | null;
  date: string | null;
};

export type FocusDraft = {
  revision: number;
  taskId?: string;
  projectId?: string;
  label?: string;
};

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
  const {
    snapshot,
    active,
    now,
    busy,
    error,
    suggestedBreak,
    notificationState,
    start,
    transition,
    dismissBreakSuggestion,
    requestNotificationPermission
  } = useFocusSession();
  const [preset, setPreset] = useState<"25" | "50" | "custom">("25");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!draft) return;
    setTaskId(draft.taskId ?? "");
    setProjectId(draft.projectId ?? "");
    setLabel(draft.label ?? "");
  }, [draft]);

  const selectedTask = tasks.find((task) => task.id === taskId) ?? null;
  const selectedProjectId = selectedTask?.projectId ?? projectId;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const todayKey = today.slice(0, 10);
  const todayTasks = useMemo(
    () => tasks.filter((task) => task.date?.slice(0, 10) === todayKey),
    [tasks, todayKey]
  );
  const otherTasks = useMemo(
    () => tasks.filter((task) => task.date?.slice(0, 10) !== todayKey),
    [tasks, todayKey]
  );
  const duration = preset === "custom" ? Number(customMinutes) : Number(preset);

  async function startFocus() {
    await start({
      kind: "FOCUS",
      plannedMinutes: duration,
      label,
      taskId: taskId || null,
      projectId: !selectedTask?.projectId ? projectId || null : null
    });
  }

  return (
    <section className="panel focus-timer-panel" aria-labelledby="focus-timer-title">
      <div className="panel-title focus-timer-title">
        <div>
          <Timer size={18} />
          <h2 id="focus-timer-title">Focus timer</h2>
        </div>
        <span>
          {snapshot
            ? `${snapshot.today.completedSessions} ${
                snapshot.today.completedSessions === 1 ? "session" : "sessions"
              } · ${snapshot.today.focusedMinutes}m`
            : "Loading…"}
        </span>
      </div>

      {active ? (
        <ActiveTimer
          session={active}
          now={now}
          busy={busy}
          onTransition={transition}
        />
      ) : (
        <div className="focus-setup">
          <div className="focus-presets" aria-label="Focus duration">
            <button
              className={preset === "25" ? "active" : ""}
              aria-pressed={preset === "25"}
              onClick={() => setPreset("25")}
            >
              <strong>25</strong>
              <span>+ 5m break</span>
            </button>
            <button
              className={preset === "50" ? "active" : ""}
              aria-pressed={preset === "50"}
              onClick={() => setPreset("50")}
            >
              <strong>50</strong>
              <span>+ 10m break</span>
            </button>
            <button
              className={preset === "custom" ? "active" : ""}
              aria-pressed={preset === "custom"}
              onClick={() => setPreset("custom")}
            >
              <strong>Custom</strong>
              <span>1–240m</span>
            </button>
          </div>

          {preset === "custom" && (
            <label className="focus-custom-duration">
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

          <div className="focus-target-grid">
            <label>
              Task
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
                <option value="">No task</option>
                {todayTasks.length > 0 && (
                  <optgroup label="Today">
                    {todayTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherTasks.length > 0 && (
                  <optgroup label="Other open tasks">
                    {otherTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              Project
              <select
                aria-label="Focus project"
                value={selectedProjectId}
                disabled={Boolean(selectedTask?.projectId)}
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
              {selectedTask?.projectId && selectedProject && (
                <small>Inherited from the selected task</small>
              )}
            </label>
          </div>

          <label className="focus-intention">
            Intention <span>optional</span>
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
            <Play size={16} />
            Start {Number.isFinite(duration) ? duration : ""}m focus
          </button>
        </div>
      )}

      {!active && suggestedBreak && (
        <div className="focus-break-callout">
          <div>
            <Coffee size={17} />
            <span>Focus block saved. Take a {suggestedBreak}-minute break?</span>
          </div>
          <div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void start({ kind: "BREAK", plannedMinutes: suggestedBreak })
              }
            >
              <Play size={14} />
              Start break
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss break suggestion"
              onClick={dismissBreakSuggestion}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error focus-error" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {!active && notificationState === "default" && (
        <button
          className="focus-notification-button"
          onClick={() => void requestNotificationPermission()}
        >
          <Bell size={14} />
          Enable completion notification
        </button>
      )}
    </section>
  );
}

export function FocusSessionBanner({ onOpenToday }: { onOpenToday: () => void }) {
  const { active, now, busy, error, transition } = useFocusSession();
  if (!active) return null;

  const remaining = focusRemainingSeconds(active, now);

  return (
    <section className="focus-session-banner" aria-label="Active focus session">
      <button className="focus-banner-main" onClick={onOpenToday}>
        {active.kind === "BREAK" ? <Coffee size={17} /> : <Timer size={17} />}
        <span>
          <small>{active.status === "PAUSED" ? "Paused" : active.kind === "BREAK" ? "Break" : "Focusing"}</small>
          <strong>{active.label}</strong>
        </span>
        <time>{formatFocusClock(remaining)}</time>
      </button>
      <div className="focus-banner-actions">
        <button
          className="icon-button"
          aria-label={active.status === "PAUSED" ? "Resume timer" : "Pause timer"}
          disabled={busy}
          onClick={() =>
            void transition(active.status === "PAUSED" ? "resume" : "pause")
          }
        >
          {active.status === "PAUSED" ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button
          className="icon-button"
          aria-label="Finish timer"
          disabled={busy}
          onClick={() => void transition("complete")}
        >
          <Check size={15} />
        </button>
        <button
          className="icon-button danger"
          aria-label="Cancel timer"
          disabled={busy}
          onClick={() => {
            if (confirmFocusCancellation(active, now)) void transition("cancel");
          }}
        >
          <X size={15} />
        </button>
      </div>
      {error && (
        <span className="sr-only" role="status" aria-live="polite">
          {error}
        </span>
      )}
    </section>
  );
}

function ActiveTimer({
  session,
  now,
  busy,
  onTransition
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
  onTransition: (action: "pause" | "resume" | "complete" | "cancel") => Promise<boolean>;
}) {
  const elapsed = focusElapsedSeconds(session, now);
  const remaining = focusRemainingSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  const association =
    session.task?.project?.name ??
    session.project?.name ??
    (session.task
      ? "Task focus"
      : session.kind === "BREAK"
        ? "Recovery"
        : "Unlinked focus");

  return (
    <div className="focus-active">
      <div
        className="focus-clock"
        style={{
          background: `conic-gradient(var(--sage) ${progress}%, var(--surface-2) ${progress}% 100%)`
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
                : "Focus"}
          </span>
        </div>
      </div>
      <div className="focus-active-copy">
        <span className="focus-kind">
          {session.kind === "BREAK" ? <Coffee size={14} /> : <Timer size={14} />}
          {association}
        </span>
        <h3>{session.label}</h3>
        {session.task && <p>{session.task.title}</p>}
        <div className="focus-controls">
          {session.status === "PAUSED" ? (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void onTransition("resume")}
            >
              <Play size={15} />
              Resume
            </button>
          ) : (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void onTransition("pause")}
            >
              <Pause size={15} />
              Pause
            </button>
          )}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void onTransition("complete")}
          >
            <Check size={15} />
            Finish early
          </button>
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => {
              if (confirmFocusCancellation(session, now)) void onTransition("cancel");
            }}
          >
            <RotateCcw size={14} />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmFocusCancellation(session: FocusSessionRecord, now: number) {
  if (session.kind !== "FOCUS" || focusElapsedSeconds(session, now) < 60) return true;
  return window.confirm(
    "Cancel this focus session? Its elapsed time will not be recorded."
  );
}
