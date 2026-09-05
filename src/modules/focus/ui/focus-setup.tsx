"use client";

import { Play } from "lucide-react";
import type { FocusTimerState } from "./use-focus-timer";
import type { FocusRailProps } from "./focus-model";

export function FocusSetup({
  focus,
  busy,
  retryNextLabel,
  preset,
  setPreset,
  customMinutes,
  setCustomMinutes,
  taskId,
  setTaskId,
  setProjectId,
  selectedTask,
  selectedProjectId,
  selectedProject,
  taskGroups,
  label,
  setLabel,
  snapshot,
  duration,
  startFocus,
  tasks,
  projects
}: Pick<FocusTimerState,
  | "focus"
  | "busy"
  | "retryNextLabel"
  | "preset"
  | "setPreset"
  | "customMinutes"
  | "setCustomMinutes"
  | "taskId"
  | "setTaskId"
  | "setProjectId"
  | "selectedTask"
  | "selectedProjectId"
  | "selectedProject"
  | "taskGroups"
  | "label"
  | "setLabel"
  | "snapshot"
  | "duration"
  | "startFocus"
> & Pick<FocusRailProps, "tasks" | "projects">) {
  return (
    <section className="rail-card focus-idle-card">
      <span className="eyebrow">Start a focus session</span>
      {focus.retryNext && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void focus.retryNextStart()}
        >
          {retryNextLabel}
        </button>
      )}
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
          {taskGroups.map((group) => (
            <optgroup key={group.key} label={group.label}>
              {group.items.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </optgroup>
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
  );
}
