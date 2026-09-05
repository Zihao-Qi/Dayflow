"use client";

import { ActivityDraft, ActivityTaskOption } from "@/components/activity-records";
import { formatLongLocalDateKey } from "@/components/dashboard-formatters";
import { ACTIVITY_CATEGORY_MAX_LENGTH } from "@/lib/activity-categories";
import { ProjectSummary } from "@/lib/project-domain";
import { Plus, Save } from "lucide-react";

export function ActivityDialog({
  mode,
  tasks,
  projects,
  todayKey,
  categorySuggestions,
  draft,
  originalTaskId,
  originalInheritedProjectId,
  error,
  saving,
  onDraftChange,
  onClose,
  onSave
}: {
  mode: "create" | "edit";
  tasks: ActivityTaskOption[];
  projects: ProjectSummary[];
  todayKey: string;
  categorySuggestions: string[];
  draft: ActivityDraft;
  originalTaskId: string | null;
  originalInheritedProjectId: string | null;
  error: string;
  saving: boolean;
  onDraftChange: (patch: Partial<ActivityDraft>) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const { date, time, duration, category, taskId, projectId, note } = draft;
  const currentTaskProjectId =
    tasks.find((task) => task.id === taskId)?.projectId ?? null;
  const usingHistoricalAttribution =
    mode === "edit" &&
    taskId === originalTaskId &&
    projectId === "" &&
    Boolean(originalInheritedProjectId);
  const linkedTaskProjectId = usingHistoricalAttribution
    ? originalInheritedProjectId
    : currentTaskProjectId;
  const title = mode === "edit" ? "Edit activity" : "Log activity";
  return (
    <div
      className="palette-overlay activity-dialog-overlay"
      role="presentation"
      onMouseDown={saving ? undefined : onClose}
    >
      <section
        className="activity-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">
              {mode === "edit"
                ? `Recorded ${formatLongLocalDateKey(date)}`
                : "Manual evidence"}
            </span>
            <h2>{title}</h2>
          </div>
          <button
            className="text-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <textarea
          aria-label="Activity note"
          autoFocus
          value={note}
          disabled={saving}
          onChange={(event) =>
            onDraftChange({ note: event.target.value })
          }
          placeholder="Record a small win or what moved forward."
        />
        <div className="activity-dialog-grid">
          {mode === "create" && (
            <label>
              Date
              <input
                aria-label="Activity date"
                type="date"
                max={todayKey}
                value={date}
                disabled={saving}
                onChange={(event) =>
                  onDraftChange({ date: event.target.value })
                }
              />
            </label>
          )}
          <label>
            Time
            <input
              type="time"
              value={time}
              disabled={saving}
              onChange={(event) =>
                onDraftChange({ time: event.target.value })
              }
            />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={duration}
              disabled={saving}
              onChange={(event) =>
                onDraftChange({ duration: event.target.value })
              }
            />
          </label>
          <label>
            Category
            <input
              aria-label="Category"
              list="activity-category-suggestions"
              maxLength={ACTIVITY_CATEGORY_MAX_LENGTH}
              value={category}
              disabled={saving}
              onChange={(event) =>
                onDraftChange({ category: event.target.value })
              }
            />
            <datalist id="activity-category-suggestions">
              {categorySuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <small>Choose a suggestion or type a custom label.</small>
          </label>
          <label>
            Linked task
            <select
              aria-label="Linked task"
              value={taskId}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value;
                onDraftChange({
                  taskId: value,
                  ...(tasks.find((task) => task.id === value)?.projectId
                    ? { projectId: "" }
                    : {})
                });
              }}
            >
              <option value="">No linked task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              aria-label="Project"
              value={linkedTaskProjectId ?? projectId}
              disabled={saving || Boolean(linkedTaskProjectId)}
              onChange={(event) =>
                onDraftChange({ projectId: event.target.value })
              }
            >
              <option value="">No Project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {linkedTaskProjectId && (
              <small>
                {usingHistoricalAttribution
                  ? "Recorded from linked task"
                  : "Inherited from linked task"}
              </small>
            )}
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => void onSave()}
          type="button"
        >
          {mode === "edit" ? <Save size={14} /> : <Plus size={14} />}
          {saving
            ? "Saving…"
            : mode === "edit"
              ? "Save changes"
              : "Add activity"}
        </button>
      </section>
    </div>
  );
}
