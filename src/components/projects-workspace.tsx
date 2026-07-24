"use client";

import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  FolderKanban,
  Layers3,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2
} from "lucide-react";
import {
  calculateProjectMetrics,
  formatInvestedMinutes,
  formatProjectDuration,
  ProjectDetail,
  ProjectDurationUnit,
  ProjectPhaseRecord,
  ProjectStatus,
  ProjectSummary,
  ProjectTaskRecord,
  projectStatusLabel
} from "@/lib/project-domain";

type ProjectsWorkspaceProps = {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  createOpen: boolean;
  today: string;
  onSelectedProjectChange: (id: string | null) => void;
  onCreateOpenChange: (open: boolean) => void;
  onDataChanged: () => Promise<void>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
  }) => void;
};

type ProjectPatch = Partial<{
  name: string;
  desiredOutcome: string;
  targetDate: string | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  confirm: boolean;
}>;

type ProjectDetailView = "overview" | "plan" | "evidence";

export function ProjectsWorkspace({
  projects,
  selectedProjectId,
  createOpen,
  today,
  onSelectedProjectChange,
  onCreateOpenChange,
  onDataChanged,
  onStartFocus
}: ProjectsWorkspaceProps) {
  const [filter, setFilter] = useState<ProjectStatus>("ACTIVE");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedProjectId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void fetch(`/api/projects/${selectedProjectId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Project could not be opened.");
        return response.json();
      })
      .then((value: ProjectDetail) => {
        if (!cancelled) setDetail(value);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  async function reloadDetail() {
    if (!selectedProjectId) return;
    const response = await fetch(`/api/projects/${selectedProjectId}`, { cache: "no-store" });
    if (!response.ok) return;
    setDetail(await response.json());
  }

  async function sync() {
    await Promise.all([reloadDetail(), onDataChanged()]);
  }

  async function updateProject(patch: ProjectPatch) {
    if (!selectedProjectId) return false;
    setError("");
    const response = await fetch(`/api/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setError(result?.error ?? "Project could not be updated.");
      return false;
    }
    setDetail(result);
    await onDataChanged();
    return true;
  }

  async function deleteProject() {
    if (!detail) return;
    if (
      !window.confirm(
        `Delete “${detail.name}”? Its tasks, activities, notes, and materials will be preserved and detached.`
      )
    ) {
      return;
    }
    const response = await fetch(`/api/projects/${detail.id}?confirm=true`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error ?? "Project could not be deleted.");
      return;
    }
    onSelectedProjectChange(null);
    await onDataChanged();
  }

  if (selectedProjectId) {
    return (
      <ProjectDetailWorkspace
        detail={detail}
        loading={loadingDetail}
        error={error}
        today={today}
        onBack={() => onSelectedProjectChange(null)}
        onUpdateProject={updateProject}
        onDeleteProject={deleteProject}
        onSync={sync}
        onError={setError}
        onStartFocus={onStartFocus}
      />
    );
  }

  const visibleProjects = projects.filter((project) => project.status === filter);

  return (
    <div className="projects-page">
      <section className="panel projects-overview">
        <div className="projects-heading">
          <div>
            <span className="eyebrow">Long-term work</span>
            <h2>Projects</h2>
            <p>Keep a finishable outcome connected to the work you do each day.</p>
          </div>
          <button className="primary-button" onClick={() => onCreateOpenChange(true)}>
            <Plus size={16} />
            New project
          </button>
        </div>

        {createOpen && (
          <ProjectCreateForm
            onCancel={() => onCreateOpenChange(false)}
            onCreated={async (project) => {
              onCreateOpenChange(false);
              await onDataChanged();
              onSelectedProjectChange(project.id);
            }}
          />
        )}

        <div className="project-filters" aria-label="Project status filters">
          {(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as ProjectStatus[]).map((status) => (
            <button
              key={status}
              className={filter === status ? "active" : ""}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {projectStatusLabel(status)}
              <span>{projects.filter((project) => project.status === status).length}</span>
            </button>
          ))}
        </div>
      </section>

      {error && <p className="project-error">{error}</p>}

      <section className="project-card-grid" aria-label={`${projectStatusLabel(filter)} projects`}>
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onOpen={() => onSelectedProjectChange(project.id)}
          />
        ))}
        {!visibleProjects.length && (
          <div className="panel project-empty">
            <FolderKanban size={32} />
            <strong>No {projectStatusLabel(filter).toLowerCase()} projects.</strong>
            <span>
              {filter === "ACTIVE"
                ? "Create one finishable outcome and give it a first step."
                : "Projects will appear here when their status changes."}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectCreateForm({
  onCancel,
  onCreated
}: {
  onCancel: () => void;
  onCreated: (project: ProjectDetail) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [targetDurationValue, setTargetDurationValue] = useState("");
  const [targetDurationUnit, setTargetDurationUnit] =
    useState<ProjectDurationUnit>("WEEKS");
  const [weeklyMinutesBudget, setWeeklyMinutesBudget] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function createProject() {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        desiredOutcome,
        targetDate: targetDate || null,
        targetDurationValue: targetDurationValue || null,
        targetDurationUnit: targetDurationValue ? targetDurationUnit : null,
        weeklyMinutesBudget: weeklyMinutesBudget || null
      })
    });
    const result = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setError(result?.error ?? "Project could not be created.");
      return;
    }
    await onCreated(result);
  }

  return (
    <div className="project-create-form" aria-label="Create project">
      <label>
        Project name <span>Required</span>
        <input
          id="new-project-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createProject();
          }}
          placeholder="Complete the machine learning course"
        />
      </label>
      <details>
        <summary>Optional details</summary>
        <div className="project-form-grid">
          <label className="full">
            Desired outcome
            <textarea
              value={desiredOutcome}
              onChange={(event) => setDesiredOutcome(event.target.value)}
              placeholder="What will be true when this is finished?"
            />
          </label>
          <label>
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
          <div className="project-duration-field">
            <span>Target duration</span>
            <div>
              <input
                aria-label="Target duration value"
                type="number"
                min="1"
                step="1"
                value={targetDurationValue}
                onChange={(event) => setTargetDurationValue(event.target.value)}
                placeholder="Amount"
              />
              <select
                aria-label="Target duration unit"
                value={targetDurationUnit}
                onChange={(event) =>
                  setTargetDurationUnit(event.target.value as ProjectDurationUnit)
                }
              >
                <option value="DAYS">Days</option>
                <option value="WEEKS">Weeks</option>
              </select>
            </div>
          </div>
          <label>
            Weekly effort budget
            <input
              type="number"
              min="5"
              step="5"
              value={weeklyMinutesBudget}
              onChange={(event) => setWeeklyMinutesBudget(event.target.value)}
              placeholder="Minutes per week"
            />
          </label>
        </div>
      </details>
      {error && <p className="form-error">{error}</p>}
      <div className="project-form-actions">
        <button className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving} onClick={() => void createProject()}>
          <Plus size={16} />
          {saving ? "Creating" : "Create project"}
        </button>
      </div>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button className="project-card panel" onClick={onOpen}>
      <div className="project-card-top">
        <span className={`project-status status-${project.status.toLowerCase()}`}>
          {projectStatusLabel(project.status)}
        </span>
        {project.targetDate && <time>{formatShortDate(project.targetDate)}</time>}
      </div>
      <div>
        <h3>{project.name}</h3>
        {project.desiredOutcome && <p>{project.desiredOutcome}</p>}
      </div>
      <div className="project-progress-copy">
        <span>
          {project.taskCount
            ? `${project.completedTaskCount} of ${project.taskCount} tasks`
            : "No tasks yet"}
        </span>
        {project.progressPercent !== null && <strong>{project.progressPercent}%</strong>}
      </div>
      <div className="meter" aria-label={`${project.progressPercent ?? 0}% of current plan`}>
        <i style={{ width: `${project.progressPercent ?? 0}%` }} />
      </div>
      <div className="project-card-meta">
        <span>
          <Clock3 size={14} />
          {formatInvestedMinutes(project.investedMinutes)} invested
        </span>
        <span>
          <Circle size={14} />
          {project.backlogCount} in backlog
        </span>
      </div>
      <div className="project-next">
        <span>Next</span>
        <strong>{project.nextTaskTitle ?? "Add a first task"}</strong>
      </div>
    </button>
  );
}

function ProjectDetailWorkspace({
  detail,
  loading,
  error,
  today,
  onBack,
  onUpdateProject,
  onDeleteProject,
  onSync,
  onError,
  onStartFocus
}: {
  detail: ProjectDetail | null;
  loading: boolean;
  error: string;
  today: string;
  onBack: () => void;
  onUpdateProject: (patch: ProjectPatch) => Promise<boolean>;
  onDeleteProject: () => Promise<void>;
  onSync: () => Promise<void>;
  onError: (error: string) => void;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newPhase, setNewPhase] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newTaskPhase, setNewTaskPhase] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [undoTaskId, setUndoTaskId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<ProjectDetailView>("overview");

  useEffect(() => {
    setDetailView("overview");
    setEditing(false);
  }, [detail?.id]);

  if (loading || !detail) {
    return (
      <section className="panel project-loading">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to Projects
        </button>
        <p>{error || "Opening project…"}</p>
      </section>
    );
  }

  const project = detail;
  const unfinishedTasks = detail.tasks.filter((task) => task.status !== "DONE");
  const backlogTasks = unfinishedTasks.filter((task) => !task.date);
  const plannedOrDoneTasks = detail.tasks.filter((task) => task.date || task.status === "DONE");
  const directTasks = plannedOrDoneTasks.filter((task) => !task.phaseId);
  const nextTask = sortTasks(unfinishedTasks)[0] ?? null;
  const allTasksDone = detail.taskCount > 0 && detail.completedTaskCount === detail.taskCount;
  const canAddWork = detail.status !== "COMPLETED" && detail.status !== "ARCHIVED";

  async function request(path: string, init: RequestInit) {
    onError("");
    const response = await fetch(path, init);
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      onError(result?.error ?? "The change could not be saved.");
      return false;
    }
    await onSync();
    return true;
  }

  async function addPhase() {
    if (!newPhase.trim()) return;
    const saved = await request(`/api/projects/${project.id}/phases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newPhase })
    });
    if (saved) setNewPhase("");
  }

  async function addTask() {
    if (!newTask.trim()) return;
    const saved = await request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTask,
        projectId: project.id,
        phaseId: newTaskPhase || null,
        date: newTaskDate || null,
        estimateMinutes: 30
      })
    });
    if (saved) {
      setNewTask("");
      setNewTaskDate("");
    }
  }

  async function updateTask(id: string, patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }) {
    const changedDate = "date" in patch;
    const saved = await request(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (saved && changedDate) setUndoTaskId(id);
  }

  async function undoSchedule(id: string) {
    const saved = await request(`/api/tasks/${id}/schedule/undo`, { method: "POST" });
    if (saved) setUndoTaskId(null);
  }

  async function deleteTask(id: string, title: string) {
    if (!window.confirm(`Delete “${title}”?`)) return;
    await request(`/api/tasks/${id}`, { method: "DELETE" });
  }

  async function deletePhase(phase: ProjectPhaseRecord) {
    if (!window.confirm(`Delete “${phase.name}”? Its tasks will move to the Project root.`)) return;
    await request(`/api/phases/${phase.id}`, { method: "DELETE" });
  }

  async function movePhase(index: number, direction: -1 | 1) {
    const target = project.phases[index + direction];
    const phase = project.phases[index];
    if (!target || !phase) return;
    await Promise.all([
      fetch(`/api/phases/${phase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: target.sortOrder })
      }),
      fetch(`/api/phases/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: phase.sortOrder })
      })
    ]);
    await onSync();
  }

  async function completeProject() {
    const confirm = project.completedTaskCount !== project.taskCount
      ? window.confirm("Complete this Project while unfinished tasks remain?")
      : true;
    if (!confirm) return;
    await onUpdateProject({ status: "COMPLETED", confirm: true });
  }

  return (
    <div className="project-detail-page">
      <button className="project-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to Projects
      </button>

      <section className="panel project-hero">
        <div className="project-hero-main">
          <span className={`project-status status-${detail.status.toLowerCase()}`}>
            {projectStatusLabel(detail.status)}
          </span>
          <h2>{detail.name}</h2>
          {detail.desiredOutcome && <p>{detail.desiredOutcome}</p>}
          <div className="project-optional-meta">
            {detail.targetDate && (
              <span>
                <CalendarDays size={15} />
                Target {formatShortDate(detail.targetDate)}
              </span>
            )}
            {detail.targetDurationValue && detail.targetDurationUnit && (
              <span>
                <CalendarDays size={15} />
                {formatProjectDuration(
                  detail.targetDurationValue,
                  detail.targetDurationUnit
                )}{" "}
                expected
              </span>
            )}
            {detail.weeklyMinutesBudget && (
              <span>
                <Clock3 size={15} />
                {formatInvestedMinutes(detail.weeklyMinutesBudget)} per week
              </span>
            )}
          </div>
        </div>
        <div className="project-hero-actions">
          <button className="secondary-button" onClick={() => setEditing((value) => !value)}>
            <Pencil size={15} />
            Edit
          </button>
          {detail.status === "ACTIVE" && (
            <button
              className="icon-button"
              title="Pause project"
              aria-label="Pause project"
              onClick={() => void onUpdateProject({ status: "PAUSED" })}
            >
              <Pause size={15} />
            </button>
          )}
          {detail.status === "PAUSED" && (
            <button
              className="icon-button"
              title="Resume project"
              aria-label="Resume project"
              onClick={() => void onUpdateProject({ status: "ACTIVE" })}
            >
              <Play size={15} />
            </button>
          )}
          {(detail.status === "COMPLETED" || detail.status === "ARCHIVED") && (
            <button
              className="secondary-button"
              onClick={() => void onUpdateProject({ status: "ACTIVE" })}
            >
              <RotateCcw size={15} />
              Reopen
            </button>
          )}
          {detail.status !== "ARCHIVED" && (
            <button
              className="icon-button"
              title="Archive project"
              aria-label="Archive project"
              onClick={() => void onUpdateProject({ status: "ARCHIVED" })}
            >
              <Archive size={15} />
            </button>
          )}
        </div>

        <div className="project-metric-row">
          <div className="project-metric">
            <span>Current plan</span>
            <strong>
              {detail.taskCount
                ? `${detail.completedTaskCount}/${detail.taskCount}`
                : "No tasks"}
            </strong>
            <div className="meter">
              <i style={{ width: `${detail.progressPercent ?? 0}%` }} />
            </div>
          </div>
          <div className="project-metric">
            <span>Invested time</span>
            <strong>{formatInvestedMinutes(detail.investedMinutes)}</strong>
            <small>From recorded activity</small>
          </div>
          <div className="project-metric">
            <span>Backlog</span>
            <strong>{detail.backlogCount}</strong>
            <small>Unscheduled tasks</small>
          </div>
        </div>

        {editing && (
          <ProjectEditForm
            project={detail}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              if (await onUpdateProject(patch)) setEditing(false);
            }}
            onComplete={completeProject}
            onDelete={onDeleteProject}
          />
        )}
      </section>

      {error && <p className="project-error">{error}</p>}

      {allTasksDone && detail.status !== "COMPLETED" && (
        <section className="project-completion-callout">
          <div>
            <Check size={18} />
            <span>
              <strong>All planned tasks are complete.</strong>
              Complete the Project, or add another step if the outcome is not finished.
            </span>
          </div>
          <button className="primary-button" onClick={() => void completeProject()}>
            Complete project
          </button>
        </section>
      )}

      <div
        className="view-switcher project-detail-switcher"
        role="tablist"
        aria-label="Project view"
      >
        {(["overview", "plan", "evidence"] as ProjectDetailView[]).map((view) => (
          <button
            key={view}
            className={detailView === view ? "active" : ""}
            aria-selected={detailView === view}
            role="tab"
            onClick={() => setDetailView(view)}
          >
            {`${view[0].toUpperCase()}${view.slice(1)}`}
          </button>
        ))}
      </div>

      {detailView === "overview" && (
        <div className="project-overview-tab" role="tabpanel" aria-label="Project overview">
          <section className="panel project-next-step">
            <span className="eyebrow">Next step</span>
            {nextTask ? (
              <>
                <h3>{nextTask.title}</h3>
                <p>
                  {nextTask.date
                    ? `Planned for ${formatShortDate(nextTask.date)}`
                    : "Waiting in backlog"}
                </p>
                <div className="project-next-actions">
                  {!nextTask.date && canAddWork && (
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void updateTask(nextTask.id, {
                          date: today.slice(0, 10),
                          scheduleSource: "project-next-step"
                        })
                      }
                    >
                      <CalendarDays size={15} />
                      Plan for today
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() =>
                      onStartFocus({
                        taskId: nextTask.id,
                        projectId: project.id,
                        label: nextTask.title
                      })
                    }
                  >
                    <Play size={15} />
                    Start focus
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setDetailView("plan")}
                  >
                    <Layers3 size={15} />
                    View plan
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>
                  {detail.taskCount
                    ? "The current plan is complete."
                    : "Give this Project a first step."}
                </h3>
                <p>Choose one action that can be finished in a sitting.</p>
                <button
                  className="secondary-button"
                  onClick={() => setDetailView("plan")}
                >
                  <Plus size={15} />
                  Add a step
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {detailView === "plan" && (
        <div className="project-plan-tab" role="tabpanel" aria-label="Project plan">
          <section className="panel project-add-task">
            <span className="eyebrow">Add a step</span>
            {canAddWork ? (
              <>
                <input
                  value={newTask}
                  onChange={(event) => setNewTask(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addTask();
                  }}
                  placeholder="A concrete, finishable task"
                  aria-label="New Project task"
                />
                <div className="project-add-task-options">
                  <select
                    value={newTaskPhase}
                    onChange={(event) => setNewTaskPhase(event.target.value)}
                    aria-label="Task phase"
                  >
                    <option value="">Project root</option>
                    {detail.phases.map((phase) => (
                      <option key={phase.id} value={phase.id}>
                        {phase.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={newTaskDate}
                    onChange={(event) => setNewTaskDate(event.target.value)}
                    aria-label="Schedule task"
                  />
                  <button className="primary-button" onClick={() => void addTask()}>
                    <Plus size={15} />
                    Add
                  </button>
                </div>
                <small>Leave the date empty to keep this task in the backlog.</small>
              </>
            ) : (
              <p>Reopen this Project before adding unfinished work.</p>
            )}
          </section>

          <section className="panel project-plan">
            <div className="project-section-heading">
              <div>
                <Layers3 size={18} />
                <div>
                  <h3>Phases and tasks</h3>
                  <span>
                    {detail.completedTaskCount} of {detail.taskCount} tasks complete
                  </span>
                </div>
              </div>
            </div>

            {directTasks.length > 0 && (
              <TaskGroup
                title="Project tasks"
                tasks={directTasks}
                phases={detail.phases}
                undoTaskId={undoTaskId}
                onUpdate={updateTask}
                onUndo={undoSchedule}
                onDelete={deleteTask}
                onStartFocus={onStartFocus}
              />
            )}

            <div className="phase-list">
              {detail.phases.map((phase, index) => {
                const phaseTasks = detail.tasks.filter((task) => task.phaseId === phase.id);
                const visiblePhaseTasks = phaseTasks.filter(
                  (task) => task.date || task.status === "DONE"
                );
                const metrics = calculateProjectMetrics(phaseTasks);
                return (
                  <article className="phase-card" key={phase.id}>
                    <div className="phase-header">
                      <EditablePhaseName phase={phase} onSaved={onSync} onError={onError} />
                      <span>
                        {metrics.taskCount
                          ? `${metrics.completedTaskCount}/${metrics.taskCount}`
                          : "No tasks"}
                      </span>
                      <div className="phase-actions">
                        <button
                          className="icon-button"
                          aria-label={`Move phase ${phase.name} up`}
                          disabled={index === 0}
                          onClick={() => void movePhase(index, -1)}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Move phase ${phase.name} down`}
                          disabled={index === detail.phases.length - 1}
                          onClick={() => void movePhase(index, 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`Delete phase ${phase.name}`}
                          onClick={() => void deletePhase(phase)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="phase-progress meter">
                      <i style={{ width: `${metrics.progressPercent ?? 0}%` }} />
                    </div>
                    {visiblePhaseTasks.length ? (
                      <TaskGroup
                        tasks={visiblePhaseTasks}
                        phases={detail.phases}
                        undoTaskId={undoTaskId}
                        onUpdate={updateTask}
                        onUndo={undoSchedule}
                        onDelete={deleteTask}
                        onStartFocus={onStartFocus}
                      />
                    ) : (
                      <p className="phase-empty">
                        {phaseTasks.length
                          ? `${phaseTasks.length} ${
                              phaseTasks.length === 1 ? "task is" : "tasks are"
                            } waiting in the backlog.`
                          : "No tasks in this phase yet."}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>

            {canAddWork && (
              <div className="phase-create">
                <input
                  value={newPhase}
                  onChange={(event) => setNewPhase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addPhase();
                  }}
                  placeholder="Add an optional phase"
                  aria-label="New phase name"
                />
                <button className="secondary-button" onClick={() => void addPhase()}>
                  <Plus size={15} />
                  Add phase
                </button>
              </div>
            )}
          </section>

          <section className="panel project-backlog">
            <div className="project-section-heading">
              <div>
                <Circle size={18} />
                <div>
                  <h3>Backlog</h3>
                  <span>Defined, but not assigned to a day</span>
                </div>
              </div>
              <strong>{backlogTasks.length}</strong>
            </div>
            {backlogTasks.length ? (
              <TaskGroup
                tasks={backlogTasks}
                phases={detail.phases}
                undoTaskId={undoTaskId}
                onUpdate={updateTask}
                onUndo={undoSchedule}
                onDelete={deleteTask}
                onStartFocus={onStartFocus}
              />
            ) : (
              <p className="empty-copy">No unfinished tasks are waiting in the backlog.</p>
            )}
          </section>
        </div>
      )}

      {detailView === "evidence" && (
        <div role="tabpanel" aria-label="Project evidence">
          <ProjectEvidence detail={detail} />
        </div>
      )}
    </div>
  );
}

function ProjectEditForm({
  project,
  onCancel,
  onSave,
  onComplete,
  onDelete
}: {
  project: ProjectDetail;
  onCancel: () => void;
  onSave: (patch: ProjectPatch) => Promise<void>;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [desiredOutcome, setDesiredOutcome] = useState(project.desiredOutcome);
  const [targetDate, setTargetDate] = useState(project.targetDate?.slice(0, 10) ?? "");
  const [targetDurationValue, setTargetDurationValue] = useState(
    project.targetDurationValue?.toString() ?? ""
  );
  const [targetDurationUnit, setTargetDurationUnit] =
    useState<ProjectDurationUnit>(project.targetDurationUnit ?? "WEEKS");
  const [weeklyMinutesBudget, setWeeklyMinutesBudget] = useState(
    project.weeklyMinutesBudget?.toString() ?? ""
  );

  return (
    <div className="project-edit-form">
      <div className="project-form-grid">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Target date
          <input
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
          />
        </label>
        <label className="full">
          Desired outcome
          <textarea
            value={desiredOutcome}
            onChange={(event) => setDesiredOutcome(event.target.value)}
          />
        </label>
        <div className="project-duration-field">
          <span>Target duration</span>
          <div>
            <input
              aria-label="Target duration value"
              type="number"
              min="1"
              step="1"
              value={targetDurationValue}
              onChange={(event) => setTargetDurationValue(event.target.value)}
              placeholder="Amount"
            />
            <select
              aria-label="Target duration unit"
              value={targetDurationUnit}
              onChange={(event) =>
                setTargetDurationUnit(event.target.value as ProjectDurationUnit)
              }
            >
              <option value="DAYS">Days</option>
              <option value="WEEKS">Weeks</option>
            </select>
          </div>
        </div>
        <label>
          Weekly effort budget
          <input
            type="number"
            min="5"
            step="5"
            value={weeklyMinutesBudget}
            onChange={(event) => setWeeklyMinutesBudget(event.target.value)}
            placeholder="Minutes per week"
          />
        </label>
      </div>
      <div className="project-edit-actions">
        <button className="text-button danger" onClick={() => void onDelete()}>
          <Trash2 size={15} />
          Delete project
        </button>
        <span />
        {project.status !== "COMPLETED" && (
          <button className="secondary-button" onClick={() => void onComplete()}>
            <Check size={15} />
            Complete
          </button>
        )}
        <button className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={() =>
            void onSave({
              name,
              desiredOutcome,
              targetDate: targetDate || null,
              targetDurationValue: targetDurationValue
                ? Number(targetDurationValue)
                : null,
              targetDurationUnit: targetDurationValue ? targetDurationUnit : null,
              weeklyMinutesBudget: weeklyMinutesBudget ? Number(weeklyMinutesBudget) : null
            })
          }
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  phases,
  undoTaskId,
  onUpdate,
  onUndo,
  onDelete,
  onStartFocus
}: {
  title?: string;
  tasks: ProjectTaskRecord[];
  phases: ProjectPhaseRecord[];
  undoTaskId: string | null;
  onUpdate: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  onDelete: (id: string, title: string) => Promise<void>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
  }) => void;
}) {
  return (
    <div className="project-task-group">
      {title && <h4>{title}</h4>}
      <div className="project-task-list">
        {sortTasks(tasks).map((task) => (
          <ProjectTaskItem
            key={task.id}
            task={task}
            phases={phases}
            canUndo={undoTaskId === task.id}
            onUpdate={onUpdate}
            onUndo={onUndo}
            onDelete={onDelete}
            onStartFocus={onStartFocus}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectTaskItem({
  task,
  phases,
  canUndo,
  onUpdate,
  onUndo,
  onDelete,
  onStartFocus
}: {
  task: ProjectTaskRecord;
  phases: ProjectPhaseRecord[];
  canUndo: boolean;
  onUpdate: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  onDelete: (id: string, title: string) => Promise<void>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
  }) => void;
}) {
  const [title, setTitle] = useState(task.title);

  useEffect(() => setTitle(task.title), [task.title]);

  return (
    <article className={task.status === "DONE" ? "project-task done" : "project-task"}>
      <button
        className="check-button"
        aria-label={task.status === "DONE" ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() =>
          void onUpdate(task.id, { status: task.status === "DONE" ? "TODO" : "DONE" })
        }
      >
        {task.status === "DONE" ? <Check size={15} /> : <Circle size={15} />}
      </button>
      <input
        className="project-task-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (title.trim() && title !== task.title) void onUpdate(task.id, { title: title.trim() });
        }}
        aria-label={`Task title: ${task.title}`}
      />
      <select
        value={task.phaseId ?? ""}
        onChange={(event) =>
          void onUpdate(task.id, { phaseId: event.target.value || null })
        }
        aria-label={`Phase for ${task.title}`}
      >
        <option value="">Project root</option>
        {phases.map((phase) => (
          <option key={phase.id} value={phase.id}>
            {phase.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={task.date?.slice(0, 10) ?? ""}
        onChange={(event) =>
          void onUpdate(task.id, {
            date: event.target.value || null,
            scheduleSource: event.target.value ? "project-date-picker" : "project-backlog"
          })
        }
        aria-label={`Scheduled date for ${task.title}`}
      />
      <div className="project-task-actions">
        {task.status !== "DONE" && (
          <button
            className="icon-button"
            aria-label={`Start focus for ${task.title}`}
            onClick={() =>
              onStartFocus({
                taskId: task.id,
                projectId: task.projectId ?? undefined,
                label: task.title
              })
            }
          >
            <Play size={14} />
          </button>
        )}
        {canUndo ? (
          <button className="text-button" onClick={() => void onUndo(task.id)}>
            <RotateCcw size={14} />
            Undo
          </button>
        ) : (
          <button
            className="icon-button danger"
            aria-label={`Delete task ${task.title}`}
            onClick={() => void onDelete(task.id, task.title)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

function EditablePhaseName({
  phase,
  onSaved,
  onError
}: {
  phase: ProjectPhaseRecord;
  onSaved: () => Promise<void>;
  onError: (error: string) => void;
}) {
  const [name, setName] = useState(phase.name);

  useEffect(() => setName(phase.name), [phase.name]);

  async function save() {
    if (!name.trim() || name.trim() === phase.name) return;
    const response = await fetch(`/api/phases/${phase.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      onError(result?.error ?? "Phase could not be renamed.");
      return;
    }
    await onSaved();
  }

  return (
    <input
      className="phase-name-input"
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => void save()}
      aria-label={`Phase name: ${phase.name}`}
    />
  );
}

function ProjectEvidence({ detail }: { detail: ProjectDetail }) {
  return (
    <div className="project-evidence-grid">
      <section className="panel">
        <div className="project-section-heading">
          <div>
            <Clock3 size={18} />
            <div>
              <h3>Recent progress</h3>
              <span>Recorded evidence of work</span>
            </div>
          </div>
        </div>
        {detail.activities.length ? (
          <div className="project-activity-list">
            {detail.activities.slice(0, 6).map((activity) => (
              <article key={activity.id}>
                <span>{formatShortDate(activity.startedAt)}</span>
                <div>
                  <strong>{activity.note}</strong>
                  <small>
                    {activity.durationMinutes}m · {activity.category}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-copy">No activity has been recorded for this Project yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="project-section-heading">
          <div>
            <NotebookPen size={18} />
            <div>
              <h3>Notes</h3>
              <span>{detail.notes.length} linked</span>
            </div>
          </div>
        </div>
        {detail.notes.length ? (
          <div className="project-note-list">
            {detail.notes.slice(0, 4).map((note) => (
              <article key={note.id}>
                <p>{note.content}</p>
                {note.tags.length > 0 && <small>{note.tags.map((tag) => `#${tag}`).join(" ")}</small>}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-copy">Link a note from Journal when an idea belongs here.</p>
        )}
      </section>

      <section className="panel">
        <div className="project-section-heading">
          <div>
            <FileText size={18} />
            <div>
              <h3>Materials</h3>
              <span>{detail.materials.length} linked</span>
            </div>
          </div>
        </div>
        {detail.materials.length ? (
          <div className="project-material-list">
            {detail.materials.slice(0, 4).map((material) => (
              <a key={material.id} href={material.url} target="_blank" rel="noreferrer">
                <span>{material.type}</span>
                <strong>{material.title}</strong>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-copy">Link references from Journal to keep them with this Project.</p>
        )}
      </section>
    </div>
  );
}

function sortTasks<T extends ProjectTaskRecord>(tasks: T[]) {
  return [...tasks].sort((a, b) => {
    if (a.status === "DONE" && b.status !== "DONE") return 1;
    if (a.status !== "DONE" && b.status === "DONE") return -1;
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
