"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
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
import { SaveStateChip, useSaveState } from "@/components/save-state";
import { SegmentedControl } from "@/components/workspace-ui";

type ProjectsWorkspaceProps = {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  createOpen: boolean;
  today: string;
  onSelectedProjectChange: (id: string | null) => void;
  onCreateOpenChange: (open: boolean) => void;
  onDataChanged: () => Promise<void>;
  onOpenBacklog: (projectId: string) => void;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
    plannedMinutes?: number;
  }) => void;
};

type ProjectView = "cards" | "list";

const PROJECTS_VIEW_STORAGE_KEY = "dayflow-projects-view";
const PROJECT_VIEW_OPTIONS: Array<[ProjectView, string]> = [
  ["cards", "Cards"],
  ["list", "List"]
];

/**
 * "compact" is the value this view was stored under before it was renamed.
 * It is still accepted so an existing preference survives the rename.
 */
function parseProjectView(value: string | null): ProjectView {
  return value === "list" || value === "compact" ? "list" : "cards";
}

function readStoredProjectView(): ProjectView {
  if (typeof window === "undefined") return "cards";
  try {
    return parseProjectView(
      window.localStorage.getItem(PROJECTS_VIEW_STORAGE_KEY)
    );
  } catch {
    return "cards";
  }
}

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

type PendingMutation = { id: string; fingerprint: string };

function mutationIdFor(
  reference: React.MutableRefObject<PendingMutation | null>,
  payload: unknown
) {
  const fingerprint = JSON.stringify(payload);
  if (reference.current?.fingerprint === fingerprint) {
    return reference.current.id;
  }
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `dayflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reference.current = { id, fingerprint };
  return id;
}

function isProjectDetailResponse(value: unknown): value is ProjectDetail {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<ProjectDetail>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.desiredOutcome === "string" &&
    ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(
      String(project.status)
    ) &&
    Number.isInteger(project.completedTaskCount) &&
    Number.isInteger(project.taskCount) &&
    Number.isInteger(project.phaseCount) &&
    Number.isInteger(project.backlogCount) &&
    Number.isInteger(project.investedMinutes) &&
    Number.isInteger(project.reviewPeriodInvestedMinutes) &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    Array.isArray(project.phases) &&
    Array.isArray(project.tasks) &&
    Array.isArray(project.activities) &&
    Array.isArray(project.notes) &&
    Array.isArray(project.materials)
  );
}

function isProjectPhaseResponse(value: unknown): value is ProjectPhaseRecord {
  if (!value || typeof value !== "object") return false;
  const phase = value as Partial<ProjectPhaseRecord>;
  return (
    typeof phase.id === "string" &&
    typeof phase.projectId === "string" &&
    typeof phase.name === "string" &&
    Number.isInteger(phase.sortOrder) &&
    typeof phase.createdAt === "string" &&
    typeof phase.updatedAt === "string"
  );
}

function isProjectTaskResponse(value: unknown): value is ProjectTaskRecord {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ProjectTaskRecord>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

function isOkResponse(value: unknown): value is { ok: true } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true
  );
}

export function ProjectsWorkspace({
  projects,
  selectedProjectId,
  createOpen,
  today,
  onSelectedProjectChange,
  onCreateOpenChange,
  onDataChanged,
  onOpenBacklog,
  onStartFocus
}: ProjectsWorkspaceProps) {
  const [filter, setFilter] = useState<ProjectStatus>("ACTIVE");
  const [view, setView] = useState<ProjectView>(readStoredProjectView);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const createButtonRef = useRef<HTMLButtonElement>(null);

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

  function closeCreateForm() {
    onCreateOpenChange(false);
    window.setTimeout(() => createButtonRef.current?.focus(), 0);
  }

  function switchView(nextView: ProjectView) {
    setView(nextView);
    try {
      window.localStorage.setItem(PROJECTS_VIEW_STORAGE_KEY, nextView);
    } catch {
      // The selected view still lasts for this session.
    }
  }

  async function updateProject(patch: ProjectPatch, reportError = true) {
    if (!selectedProjectId) return false;
    setError("");
    let result: unknown;
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      result = await response.json().catch(() => null);
      if (!response.ok || !isProjectDetailResponse(result)) {
        if (reportError) {
          setError(
            result &&
              typeof result === "object" &&
              "error" in result &&
              typeof result.error === "string"
              ? result.error
              : "Project could not be updated. Your edits are still here."
          );
        }
        return false;
      }
    } catch {
      if (reportError) {
        setError("Project could not be updated. Your edits are still here.");
      }
      return false;
    }
    setDetail(result);
    try {
      await onDataChanged();
    } catch {
      setError(
        "The Project was saved, but the Project list could not be refreshed."
      );
    }
    return true;
  }

  async function deleteProject() {
    if (!detail) return;
    try {
      const response = await fetch(
        `/api/projects/${detail.id}?confirm=true`,
        { method: "DELETE" }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok || !isOkResponse(result)) {
        setError(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "Project could not be deleted."
        );
        return;
      }
    } catch {
      setError("Project could not be deleted.");
      return;
    }
    onSelectedProjectChange(null);
    try {
      await onDataChanged();
    } catch {
      setError(
        "The Project was deleted, but the Project list could not be refreshed."
      );
    }
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
        onOpenBacklog={onOpenBacklog}
        onStartFocus={onStartFocus}
      />
    );
  }

  const visibleProjects = projects.filter((project) => project.status === filter);
  const showList = view === "list" && visibleProjects.length > 0;

  return (
    <div className="projects-page">
      <section className="panel projects-overview">
        <div className="projects-heading">
          <div>
            <span className="eyebrow">Long-term work</span>
            <h1>Projects</h1>
            <p>Keep a finishable outcome connected to the work you do each day.</p>
          </div>
          <button
            ref={createButtonRef}
            type="button"
            className="primary-button"
            onClick={() => onCreateOpenChange(true)}
          >
            <Plus size={16} />
            New project
          </button>
        </div>

        {createOpen && (
          <ProjectCreateForm
            onCancel={closeCreateForm}
            onCreated={async (project) => {
              onCreateOpenChange(false);
              try {
                await onDataChanged();
              } catch {
                setError(
                  "The Project was saved, but the Project list could not be refreshed."
                );
              }
              onSelectedProjectChange(project.id);
            }}
          />
        )}

        <div className="project-filter-row">
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
          <SegmentedControl
            ariaLabel="Project view"
            className="project-view-control"
            value={view}
            options={PROJECT_VIEW_OPTIONS}
            onChange={switchView}
          />
        </div>
      </section>

      {error && <p className="project-error">{error}</p>}

      <section
        className={
          showList ? "project-list panel" : "project-card-grid"
        }
        aria-label={`${projectStatusLabel(filter)} projects`}
      >
        {visibleProjects.map((project) =>
          showList ? (
            <ProjectRow
              key={project.id}
              project={project}
              today={today}
              onOpen={() => onSelectedProjectChange(project.id)}
              onStartFocus={onStartFocus}
              onDataChanged={onDataChanged}
            />
          ) : (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => onSelectedProjectChange(project.id)}
              onStartFocus={onStartFocus}
            />
          )
        )}
        {showList ? (
          <button
            type="button"
            className="project-create-row"
            onClick={() => onCreateOpenChange(true)}
          >
            <Plus size={15} />
            New project
          </button>
        ) : (
          <button
            type="button"
            className="project-create-card"
            onClick={() => onCreateOpenChange(true)}
          >
            <Plus size={20} />
            <strong>Start a finishable outcome</strong>
            <span>Name it first. Duration, weekly effort and phases are optional.</span>
          </button>
        )}
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
  const [durationChoice, setDurationChoice] = useState<"1" | "3" | "6" | "date">("3");
  const [weeklyHours, setWeeklyHours] = useState("5");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const createMutation = useRef<PendingMutation | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, saving]);

  async function createProject() {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    const payload = {
      name,
      desiredOutcome,
      targetDate: durationChoice === "date" ? targetDate || null : null,
      targetDurationValue:
        durationChoice === "date" ? null : Number(durationChoice),
      targetDurationUnit: durationChoice === "date" ? null : "WEEKS",
      weeklyMinutesBudget: weeklyHours
        ? Math.max(0, Math.round(Number(weeklyHours) * 60))
        : null
    };
    const mutationId = mutationIdFor(createMutation, payload);
    setSaving(true);
    setError("");
    let result: ProjectDetail | null = null;
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isProjectDetailResponse(body) ||
        body.name !== payload.name.trim() ||
        body.desiredOutcome !== payload.desiredOutcome.trim()
      ) {
        setError(
          body && typeof body.error === "string"
            ? body.error
            : "Project could not be created. Your draft is still here."
        );
        return;
      }
      result = body;
    } catch {
      setError("Project could not be created. Your draft is still here.");
      return;
    } finally {
      setSaving(false);
    }
    if (!result) {
      return;
    }
    createMutation.current = null;
    await onCreated(result);
  }

  return (
    <div
      className="project-dialog-overlay"
      role="presentation"
      onMouseDown={saving ? undefined : onCancel}
    >
      <section
        className="project-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow focus-eyebrow">New project</span>
            <h2>A finishable outcome</h2>
          </div>
          <kbd>esc</kbd>
        </header>
        <div className="project-dialog-body">
          <label>
            Name <strong>required</strong>
            <input
              id="new-project-name"
              autoFocus
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createProject();
              }}
              placeholder="What will be true when this is done?"
            />
          </label>
          <label>
            Outcome
            <textarea
              value={desiredOutcome}
              disabled={saving}
              onChange={(event) => setDesiredOutcome(event.target.value)}
              placeholder="One or two sentences. Optional."
            />
          </label>
          <fieldset className="project-duration-chips">
            <legend>Target duration <span>optional — how long the whole thing should take</span></legend>
            <div>
              {(["1", "3", "6"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={saving}
                  className={durationChoice === value ? "active" : ""}
                  onClick={() => setDurationChoice(value)}
                >
                  {value} {value === "1" ? "week" : "weeks"}
                </button>
              ))}
              <button
                type="button"
                disabled={saving}
                className={durationChoice === "date" ? "active pick-date" : "pick-date"}
                onClick={() => setDurationChoice("date")}
              >
                Pick an end date
              </button>
            </div>
            {durationChoice === "date" && (
              <input
                type="date"
                aria-label="Project end date"
                value={targetDate}
                disabled={saving}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            )}
          </fieldset>
          <label>
            Weekly effort <span>optional — hours per week you expect to give it</span>
            <span className="project-weekly-input">
              <input
                type="number"
                min="0"
                step="0.5"
                value={weeklyHours}
                disabled={saving}
                onChange={(event) => setWeeklyHours(event.target.value)}
              />
              <small>h / week</small>
            </span>
          </label>
          <p className="project-duration-note">
            Duration and weekly effort are separate on purpose — one is a deadline,
            the other is a budget. Phases and tasks come later, from the project page.
          </p>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer>
          <button className="text-button" disabled={saving} onClick={onCancel}>
          Cancel
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void createProject()}
          >
            {saving ? "Creating" : "Create project"}
          </button>
        </footer>
      </section>
    </div>
  );
}

/**
 * One project as a single row, with an optional drawer of its tasks.
 *
 * The disclosure is a dedicated button rather than a `<details>`/`<summary>`
 * wrapper: the row already carries two controls (the name opens the Project,
 * the Focus button starts a session) and anything inside a `<summary>` toggles
 * it when clicked, so those would fight each other.
 */
function ProjectRow({
  project,
  today,
  onOpen,
  onStartFocus,
  onDataChanged
}: {
  project: ProjectSummary;
  today: string;
  onOpen: () => void;
  onStartFocus: ProjectsWorkspaceProps["onStartFocus"];
  onDataChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<ProjectRowPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editError, setEditError] = useState("");
  // The overview payload refreshes whenever Project data changes, so its own
  // counts stand in for "the plan moved". Without this, completing a Focus
  // Session started from this row updates the summary beside a drawer still
  // showing the Task as unfinished, and collapsing does not repair it.
  const planKey = [
    project.taskCount,
    project.completedTaskCount,
    project.nextTaskId ?? "",
    project.progressPercent ?? ""
  ].join(":");
  const loadedKey = useRef(planKey);
  const requestToken = useRef(0);
  const taskCreateMutation = useRef<PendingMutation | null>(null);
  const statusLabel = projectStatusLabel(project.status);
  const plannedMinutes = project.nextTaskEstimateMinutes ?? 30;
  const nextTaskTitle = project.nextTaskTitle ?? "Add a first task";
  const taskProgressLabel = project.taskCount
    ? `${project.completedTaskCount}/${project.taskCount} tasks`
    : "No tasks yet";
  const drawerId = `project-tasks-${project.id}`;

  // Tasks are not in the overview payload, so the first expand fetches the
  // same detail the Project page uses and keeps it for later toggles.
  //
  // Kept separate from `toggle` so a failed load can be retried in place. A
  // retry that went through `toggle` would read the drawer as open and close
  // it instead of fetching again.
  async function loadPlan() {
    // Each attempt takes a token and only the newest one is allowed to write.
    // A guard on `loading` would drop the reload instead: when the summary
    // moves while a fetch is already in flight, that fetch is carrying
    // pre-change data, and letting it settle unchallenged reinstates exactly
    // the staleness the reload exists to clear.
    const token = requestToken.current + 1;
    requestToken.current = token;
    const requestedKey = planKey;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        cache: "no-store"
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !Array.isArray(result.tasks)) {
        throw new Error("unavailable");
      }
      if (token !== requestToken.current) return;
      loadedKey.current = requestedKey;
      setPlan({
        tasks: result.tasks as ProjectTaskRecord[],
        phases: Array.isArray(result.phases)
          ? (result.phases as ProjectPhaseRecord[])
          : []
      });
    } catch {
      if (token !== requestToken.current) return;
      setLoadError("These tasks could not be loaded. Try again.");
    } finally {
      if (token === requestToken.current) setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !plan) void loadPlan();
  }

  /**
   * Mirrors the Project page's own request helper. A rename leaves the
   * summary counts untouched, so the drawer is reloaded explicitly rather
   * than waiting for the cache key to move.
   */
  async function mutate(
    path: string,
    init: RequestInit,
    validateResult: (value: unknown) => boolean
  ) {
    setEditError("");
    try {
      const response = await fetch(path, init);
      const result = await response.json().catch(() => null);
      if (!response.ok || !validateResult(result)) {
        setEditError(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "The change could not be saved. Your draft is still here."
        );
        return false;
      }
    } catch {
      setEditError("The change could not be saved. Your draft is still here.");
      return false;
    }
    await loadPlan();
    try {
      await onDataChanged();
    } catch {
      setEditError(
        "Your change was saved, but the Project list could not be refreshed."
      );
    }
    return true;
  }

  function updateTask(
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) {
    return mutate(
      `/api/tasks/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      },
      (value) => isProjectTaskResponse(value) && value.id === id
    ).then(() => undefined);
  }

  function deleteTask(id: string) {
    return mutate(
      `/api/tasks/${id}`,
      { method: "DELETE" },
      (value) =>
        Boolean(
          value && typeof value === "object" && "ok" in value && value.ok === true
        )
    );
  }

  /**
   * Carries a mutation id that survives a retry, so a create whose response
   * was lost is recognised by the server as a replay rather than committed a
   * second time. The id is held until the create is confirmed, which is
   * exactly the window in which the drawer keeps the title and invites one.
   */
  async function addTask(title: string, phaseId: string | null) {
    const payload = {
      title,
      projectId: project.id,
      phaseId,
      date: null,
      estimateMinutes: 30
    };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    const saved = await mutate(
      "/api/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      },
      (value) =>
        isProjectTaskResponse(value) &&
        value.title === payload.title.trim() &&
        value.projectId === payload.projectId &&
        value.phaseId === payload.phaseId
    );
    if (saved) taskCreateMutation.current = null;
    return saved;
  }

  useEffect(() => {
    if (loadedKey.current === planKey) return;
    loadedKey.current = planKey;
    setPlan(null);
    if (expanded) void loadPlan();
  }, [planKey, expanded]);

  return (
    <article className={expanded ? "project-row is-expanded" : "project-row"}>
      {/*
        Chevron, status dot and name are one control. Opening the Project is
        the rarer errand, so it gets the small explicit button at the end of
        the row and this large target does the thing you came here to do.
      */}
      <button
        type="button"
        className="project-row-toggle"
        aria-expanded={expanded}
        aria-controls={drawerId}
        title={project.name}
        onClick={toggle}
      >
        <ChevronRight
          className="project-row-chevron"
          size={14}
          aria-hidden="true"
        />
        <span
          className={`project-row-dot status-${project.status.toLowerCase()}`}
          aria-hidden="true"
        />
        <span className="project-row-name">{project.name}</span>
        <span className="sr-only">, {statusLabel}</span>
      </button>
      <div className="project-row-progress">
        <div
          className="meter slim"
          aria-label={`${project.progressPercent ?? 0}% of current plan`}
        >
          <i style={{ width: `${project.progressPercent ?? 0}%` }} />
        </div>
        <span>{project.progressPercent === null ? "—" : `${project.progressPercent}%`}</span>
      </div>
      <span className="project-row-tasks" title={taskProgressLabel}>
        {taskProgressLabel}
      </span>
      <span className="project-row-next" title={nextTaskTitle}>
        <span>Next:</span>
        <strong>{nextTaskTitle}</strong>
      </span>
      {project.nextTaskId && (
        <button
          type="button"
          className="secondary-button focus-button project-row-focus"
          aria-label={`Focus ${plannedMinutes}m on ${nextTaskTitle}`}
          onClick={() => onStartFocus(focusTargetFor(project))}
        >
          <Play size={13} />
          {plannedMinutes}m
        </button>
      )}
      <button
        type="button"
        className="project-row-details"
        aria-label={`Open ${project.name} overview`}
        title={`Open ${project.name} overview`}
        onClick={onOpen}
      >
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="project-row-drawer" id={drawerId}>
          <ProjectRowTasks
            plan={plan}
            loading={loading}
            error={loadError}
            editError={editError}
            today={today}
            canManagePlan={
              project.status !== "COMPLETED" && project.status !== "ARCHIVED"
            }
            onRetry={() => void loadPlan()}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
            onAddTask={addTask}
            onStartFocus={onStartFocus}
          />
        </div>
      )}
    </article>
  );
}

type ProjectRowPlan = {
  tasks: ProjectTaskRecord[];
  phases: ProjectPhaseRecord[];
};

/**
 * Read-only on purpose. Editing, scheduling and phase management all live on
 * the Project page; repeating them here would mean two places to keep in step.
 */
function ProjectRowTasks({
  plan,
  loading,
  error,
  editError,
  today,
  canManagePlan,
  onRetry,
  onUpdateTask,
  onDeleteTask,
  onAddTask,
  onStartFocus
}: {
  plan: ProjectRowPlan | null;
  loading: boolean;
  error: string;
  editError: string;
  today: string;
  canManagePlan: boolean;
  onRetry: () => void;
  onUpdateTask: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onDeleteTask: (id: string) => Promise<boolean>;
  onAddTask: (title: string, phaseId: string | null) => Promise<boolean>;
  onStartFocus: ProjectsWorkspaceProps["onStartFocus"];
}) {
  if (loading) {
    return (
      <p className="project-row-drawer-state" role="status">
        Loading tasks…
      </p>
    );
  }

  if (error) {
    return (
      <p className="project-row-drawer-state" role="alert">
        {error}{" "}
        <button type="button" className="text-button" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }

  if (!plan) return null;

  // Falls through rather than returning: an empty Project is exactly when the
  // add control is most useful, and it is now right here in the drawer.
  const emptyPlan = plan.tasks.length === 0;

  // Seeded from `plan.phases`, which the API returns in the Project's own
  // sortOrder, so the drawer keeps the configured sequence. Deriving the order
  // from the tasks instead would let a phase holding only completed work fall
  // behind a later one, because completed tasks sort last.
  type DrawerGroup = {
    key: string;
    label: string | null;
    tasks: ProjectTaskRecord[];
  };
  const groups: DrawerGroup[] = plan.phases.map((phase) => ({
    key: `phase:${phase.id}`,
    label: phase.name,
    tasks: []
  }));
  const byKey = new Map(groups.map((group) => [group.key, group]));
  // Unphased work first, then the phases. The Project workspace renders its
  // "Project tasks" section above `.phase-list`, and opening a Project from
  // this drawer should not reshuffle the groups.
  const rootGroup: DrawerGroup = {
    key: "root",
    label: plan.phases.length ? "No phase" : null,
    tasks: []
  };
  groups.unshift(rootGroup);

  for (const task of sortTasks(plan.tasks)) {
    const group = task.phaseId ? byKey.get(`phase:${task.phaseId}`) : rootGroup;
    (group ?? rootGroup).tasks.push(task);
  }

  const filledGroups = groups.filter((group) => group.tasks.length > 0);

  return (
    <>
      {editError && (
        <p className="project-row-edit-error" role="alert">
          {editError}
        </p>
      )}
      {emptyPlan && (
        <p className="project-row-drawer-state">No tasks yet.</p>
      )}
      {filledGroups.map((group) => (
        <div key={group.key} className="project-row-task-group">
          {group.label && (
            <span className="project-row-phase">{group.label}</span>
          )}
          <div className="project-task-list">
            {group.tasks.map((task) => (
              <ProjectTaskItem
                key={task.id}
                task={task}
                phases={plan.phases}
                today={today}
                canManagePlan={canManagePlan}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onStartFocus={onStartFocus}
              />
            ))}
          </div>
        </div>
      ))}
      {canManagePlan && (
        <ProjectRowAddTask phases={plan.phases} onAdd={onAddTask} />
      )}
    </>
  );
}

function ProjectRowAddTask({
  phases,
  onAdd
}: {
  phases: ProjectPhaseRecord[];
  onAdd: (title: string, phaseId: string | null) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const added = await onAdd(trimmed, phaseId || null);
    setSaving(false);
    if (added) setTitle("");
  }

  return (
    <div className="project-row-add-task">
      <input
        value={title}
        disabled={saving}
        placeholder="Add a task"
        aria-label="New Project task"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
      {phases.length > 0 && (
        <select
          value={phaseId}
          disabled={saving}
          aria-label="Phase for the new task"
          onChange={(event) => setPhaseId(event.target.value)}
        >
          <option value="">No phase</option>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={saving || !title.trim()}
        onClick={() => void submit()}
      >
        <Plus size={14} />
        {saving ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onStartFocus
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onStartFocus: ProjectsWorkspaceProps["onStartFocus"];
}) {
  return (
    <article className="project-card panel">
      <div className="project-card-top">
        <span className={`project-status status-${project.status.toLowerCase()}`}>
          {projectStatusLabel(project.status)}
        </span>
        {project.targetDate && (
          <time>
            {project.targetDurationValue && project.targetDurationUnit
              ? `${formatProjectDuration(project.targetDurationValue, project.targetDurationUnit)} left · `
              : ""}
            {formatShortDate(project.targetDate)}
          </time>
        )}
      </div>
      <button type="button" className="project-card-open" onClick={onOpen}>
        <h3>{project.name}</h3>
        {project.desiredOutcome && <p>{project.desiredOutcome}</p>}
      </button>
      <div className="project-progress-copy">
        <span>
          {project.taskCount
            ? `${project.completedTaskCount} of ${project.taskCount} tasks complete`
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
          {formatInvestedMinutes(project.investedMinutes)} invested ·{" "}
          {project.weeklyMinutesBudget
            ? `${formatInvestedMinutes(project.weeklyMinutesBudget)}/week budget`
            : "No weekly budget"}
        </span>
        <span>
          <Layers3 size={14} />
          {project.phaseCount} {project.phaseCount === 1 ? "phase" : "phases"}
        </span>
      </div>
      <div className="project-next">
        <div>
          <span>Next step</span>
          <strong>{project.nextTaskTitle ?? "Add a first task"}</strong>
        </div>
        {project.nextTaskId && (
          <button
            type="button"
            className="secondary-button focus-button"
            onClick={() => onStartFocus(focusTargetFor(project))}
          >
            <Play size={14} />
            Focus {project.nextTaskEstimateMinutes ?? 30}m
          </button>
        )}
      </div>
    </article>
  );
}

function focusTargetFor(
  project: ProjectSummary
): Parameters<ProjectsWorkspaceProps["onStartFocus"]>[0] {
  return {
    taskId: project.nextTaskId ?? undefined,
    projectId: project.id,
    label: project.nextTaskTitle ?? project.name,
    plannedMinutes: project.nextTaskEstimateMinutes ?? 30
  };
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
  onOpenBacklog,
  onStartFocus
}: {
  detail: ProjectDetail | null;
  loading: boolean;
  error: string;
  today: string;
  onBack: () => void;
  onUpdateProject: (
    patch: ProjectPatch,
    reportError?: boolean
  ) => Promise<boolean>;
  onDeleteProject: () => Promise<void>;
  onSync: () => Promise<void>;
  onError: (error: string) => void;
  onOpenBacklog: (projectId: string) => void;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
    plannedMinutes?: number;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newPhase, setNewPhase] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newTaskPhase, setNewTaskPhase] = useState("");
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [phaseComposerOpen, setPhaseComposerOpen] = useState(false);
  const phaseCreateMutation = useRef<PendingMutation | null>(null);
  const taskCreateMutation = useRef<PendingMutation | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setEditing(false);
    setPhaseComposerOpen(false);
    setCollapsedPhases(new Set());
    phaseCreateMutation.current = null;
    taskCreateMutation.current = null;
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
  const directTasks = detail.tasks.filter((task) => !task.phaseId);
  const nextTask = sortTasks(unfinishedTasks)[0] ?? null;
  const nextTaskPhase = nextTask?.phaseId
    ? detail.phases.find((phase) => phase.id === nextTask.phaseId) ?? null
    : null;
  const allTasksDone = detail.taskCount > 0 && detail.completedTaskCount === detail.taskCount;
  const canAddWork = detail.status !== "COMPLETED" && detail.status !== "ARCHIVED";

  async function request(
    path: string,
    init: RequestInit,
    validateResult: (value: unknown) => boolean
  ) {
    onError("");
    let result: unknown;
    try {
      const response = await fetch(path, init);
      result = await response.json().catch(() => null);
      if (!response.ok || !validateResult(result)) {
        onError(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "The change could not be saved. Your draft is still here."
        );
        return false;
      }
    } catch {
      onError("The change could not be saved. Your draft is still here.");
      return false;
    }
    try {
      await onSync();
    } catch {
      onError(
        "Your change was saved, but the latest Project view could not be refreshed. Reload to try again."
      );
    }
    return true;
  }

  async function addPhase() {
    if (!newPhase.trim() || phaseSaving) return;
    const payload = { name: newPhase };
    const mutationId = mutationIdFor(phaseCreateMutation, payload);
    setPhaseSaving(true);
    const saved = await request(
      `/api/projects/${project.id}/phases`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      },
      (value) =>
        isProjectPhaseResponse(value) &&
        value.projectId === project.id &&
        value.name === payload.name.trim()
    );
    setPhaseSaving(false);
    if (saved) {
      phaseCreateMutation.current = null;
      setNewPhase("");
      setPhaseComposerOpen(false);
    }
  }

  async function addTask() {
    if (!newTask.trim() || taskSaving) return;
    const payload = {
      title: newTask,
      projectId: project.id,
      phaseId: newTaskPhase || null,
      date: null,
      estimateMinutes: 30
    };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    setTaskSaving(true);
    const saved = await request(
      "/api/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      },
      (value) =>
        isProjectTaskResponse(value) &&
        value.title === payload.title.trim() &&
        value.projectId === payload.projectId &&
        value.phaseId === payload.phaseId
    );
    setTaskSaving(false);
    if (saved) {
      taskCreateMutation.current = null;
      setNewTask("");
    }
  }

  async function updateTask(id: string, patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }) {
    await request(
      `/api/tasks/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      },
      (value) => isProjectTaskResponse(value) && value.id === id
    );
  }

  async function deleteTask(id: string) {
    return request(
      `/api/tasks/${id}`,
      { method: "DELETE" },
      (value) =>
        Boolean(
          value &&
            typeof value === "object" &&
            "ok" in value &&
            value.ok === true
        )
    );
  }

  async function deletePhase(id: string) {
    const deleted = await request(
      `/api/phases/${id}`,
      { method: "DELETE" },
      (value) =>
        Boolean(
          value &&
            typeof value === "object" &&
            "ok" in value &&
            value.ok === true
        )
    );
    if (deleted) {
      setNewTaskPhase((selectedPhase) =>
        selectedPhase === id ? "" : selectedPhase
      );
    }
    return deleted;
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
        All projects
      </button>

      <section className="panel project-hero">
        <div className="project-hero-main">
          <span className={`project-status status-${detail.status.toLowerCase()}`}>
            {projectStatusLabel(detail.status)}
          </span>
          <h1>{detail.name}</h1>
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
            <span>Plan progress</span>
            <strong>
              {detail.taskCount
                ? `${detail.completedTaskCount} of ${detail.taskCount}`
                : "No tasks"}
            </strong>
            <div className="meter">
              <i style={{ width: `${detail.progressPercent ?? 0}%` }} />
            </div>
          </div>
          <div className="project-metric">
            <span>Invested time</span>
            <strong>{formatInvestedMinutes(detail.investedMinutes)}</strong>
            <small>
              {detail.weeklyMinutesBudget
                ? `${formatInvestedMinutes(detail.reviewPeriodInvestedMinutes)} this review period · ${formatInvestedMinutes(detail.weeklyMinutesBudget)} weekly budget`
                : `${formatInvestedMinutes(detail.reviewPeriodInvestedMinutes)} this review period`}
            </small>
          </div>
          <div className="project-metric">
            <span>Target duration</span>
            <strong>
              {detail.targetDurationValue && detail.targetDurationUnit
                ? formatProjectDuration(
                    detail.targetDurationValue,
                    detail.targetDurationUnit
                  )
                : "Open"}
            </strong>
            <small>
              {detail.targetDate
                ? `Ends ${formatShortDate(detail.targetDate)}`
                : detail.targetDurationValue && detail.targetDurationUnit
                  ? "Intended span · no fixed end date"
                  : "No target date"}
            </small>
          </div>
          <button
            className="project-metric project-metric-button"
            onClick={() => onOpenBacklog(project.id)}
          >
            <span>Backlog</span>
            <strong>{detail.backlogCount}</strong>
            <small>Unscheduled tasks · open by project</small>
          </button>
        </div>

        {editing && (
          <ProjectEditForm
            project={detail}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              if (await onUpdateProject(patch)) setEditing(false);
            }}
            onSaveName={(name) => onUpdateProject({ name }, false)}
            onNameSaveError={() =>
              onError("Couldn’t save the project name. Your text is still here — retry.")
            }
            onNameSaveRecovered={() => onError("")}
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

      <section className="panel project-next-step">
        {nextTask ? (
          <>
            <div className="project-next-step-copy">
              <span className="eyebrow">Next step</span>
              <h3>{nextTask.title}</h3>
              <p>
                {[
                  nextTaskPhase?.name ?? "Project root",
                  nextTask.date
                    ? `scheduled ${formatProjectTaskDate(nextTask.date, today)}`
                    : "backlog",
                  `${nextTask.estimateMinutes}m estimate`
                ].join(" · ")}
              </p>
            </div>
            <div className="project-next-actions">
              <button
                className="secondary-button focus-button"
                onClick={() =>
                  onStartFocus({
                    taskId: nextTask.id,
                    projectId: project.id,
                    label: nextTask.title,
                    plannedMinutes: nextTask.estimateMinutes
                  })
                }
              >
                <Play size={15} />
                Focus {nextTask.estimateMinutes}m
              </button>
              <button
                className="secondary-button"
                onClick={() => void updateTask(nextTask.id, { status: "DONE" })}
              >
                Mark done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="project-next-step-copy">
              <span className="eyebrow">Next step</span>
              <h3>
                {detail.taskCount
                  ? "The current plan is complete."
                  : "Give this Project a first step."}
              </h3>
              <p>Choose one action that can be finished in a sitting.</p>
            </div>
            {canAddWork && (
              <button
                className="secondary-button"
                onClick={() => document.getElementById("project-new-task")?.focus()}
              >
                <Plus size={15} />
                Add a task
              </button>
            )}
          </>
        )}
      </section>

      <section className="project-plan-section" aria-labelledby="project-plan-heading">
        <div className="project-plan-heading">
          <h2 id="project-plan-heading">Plan</h2>
          {canAddWork ? (
            <div className="project-plan-add">
              <input
                id="project-new-task"
                value={newTask}
                disabled={taskSaving}
                onChange={(event) => setNewTask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addTask();
                }}
                placeholder="Add a task"
                aria-label="New Project task"
              />
              <select
                value={newTaskPhase}
                disabled={taskSaving}
                onChange={(event) => setNewTaskPhase(event.target.value)}
                aria-label="Task phase"
              >
                <option value="">No phase</option>
                {detail.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>
              <button
                className="primary-button"
                disabled={taskSaving || !newTask.trim()}
                onClick={() => void addTask()}
              >
                {taskSaving ? "Adding…" : "Add"}
              </button>
            </div>
          ) : (
            <p>Reopen this Project before adding unfinished work.</p>
          )}
        </div>

        {directTasks.length > 0 && detail.phases.length > 0 && (
          <ProjectPhaseSection
            title="Project tasks"
            tasks={directTasks}
            phases={detail.phases}
            today={today}
            canManagePlan={canAddWork}
            onUpdate={updateTask}
            onDelete={deleteTask}
            onStartFocus={onStartFocus}
          />
        )}

        {directTasks.length > 0 && detail.phases.length === 0 && (
          <section className="project-root-tasks">
            <header>
              <h2>Tasks</h2>
              <span>
                {directTasks.length} {directTasks.length === 1 ? "task" : "tasks"},
                none grouped
              </span>
            </header>
            <TaskGroup
              tasks={directTasks}
              phases={detail.phases}
              today={today}
              canManagePlan={canAddWork}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onStartFocus={onStartFocus}
            />
          </section>
        )}

        <div className="phase-list">
          {detail.phases.map((phase) => {
            const phaseTasks = detail.tasks.filter((task) => task.phaseId === phase.id);
            const collapsed = collapsedPhases.has(phase.id);
            return (
              <ProjectPhaseSection
                key={phase.id}
                phase={phase}
                title={phase.name}
                tasks={phaseTasks}
                phases={detail.phases}
                today={today}
                collapsed={collapsed}
                canManagePlan={canAddWork}
                onToggle={() =>
                  setCollapsedPhases((current) => {
                    const next = new Set(current);
                    if (next.has(phase.id)) next.delete(phase.id);
                    else next.add(phase.id);
                    return next;
                  })
                }
                onUpdate={updateTask}
                onDelete={deleteTask}
                onStartFocus={onStartFocus}
                onPhaseSaved={onSync}
                onDeletePhase={deletePhase}
                onError={onError}
              />
            );
          })}
        </div>

        {!directTasks.length && !detail.phases.length && (
          <p className="empty-copy project-plan-empty">
            No steps yet. Add one concrete action above.
          </p>
        )}

        {canAddWork && detail.phases.length === 0 && (
          <section className="project-phases-empty">
            <strong>Phases are optional</strong>
            <p>
              Tasks can live at the project root indefinitely. Add a phase only
              when the order of the work starts to matter more than the list of it.
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setPhaseComposerOpen(true);
                window.setTimeout(
                  () => document.getElementById("project-new-phase")?.focus(),
                  0
                );
              }}
            >
              <Plus size={14} />
              Add a phase
            </button>
          </section>
        )}

        {canAddWork && (detail.phases.length > 0 || phaseComposerOpen) && (
          <div className="phase-create">
            <input
              id="project-new-phase"
              value={newPhase}
              disabled={phaseSaving}
              onChange={(event) => setNewPhase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addPhase();
              }}
              placeholder="Add an optional phase"
              aria-label="New phase name"
            />
            <button
              className="secondary-button"
              disabled={phaseSaving || !newPhase.trim()}
              onClick={() => void addPhase()}
            >
              <Plus size={15} />
              {phaseSaving ? "Adding…" : "Add phase"}
            </button>
          </div>
        )}
      </section>

      <ProjectEvidence detail={detail} />
    </div>
  );
}

function ProjectEditForm({
  project,
  onCancel,
  onSave,
  onSaveName,
  onNameSaveError,
  onNameSaveRecovered,
  onDelete
}: {
  project: ProjectDetail;
  onCancel: () => void;
  onSave: (patch: ProjectPatch) => Promise<void>;
  onSaveName: (name: string) => Promise<boolean>;
  onNameSaveError: () => void;
  onNameSaveRecovered: () => void;
  onDelete: () => Promise<void>;
}) {
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
  const [status, setStatus] = useState<ProjectStatus>(
    project.status === "ARCHIVED" ? "PAUSED" : project.status
  );
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameSave = useSaveState({
    value: project.name,
    save: onSaveName,
    normalize: (value: string) => value.trim(),
    isValid: (value: string) => Boolean(value),
    onFinalError: onNameSaveError,
    onRecovered: onNameSaveRecovered
  });
  const name = nameSave.draft;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (deleteConfirmOpen) setDeleteConfirmOpen(false);
      else onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteConfirmOpen, onCancel]);

  const dirty =
    name !== project.name ||
    desiredOutcome !== project.desiredOutcome ||
    targetDate !== (project.targetDate?.slice(0, 10) ?? "") ||
    targetDurationValue !== (project.targetDurationValue?.toString() ?? "") ||
    targetDurationUnit !== (project.targetDurationUnit ?? "WEEKS") ||
    weeklyMinutesBudget !== (project.weeklyMinutesBudget?.toString() ?? "") ||
    status !== project.status;
  const statusCopy =
    status === "ACTIVE"
      ? "Active projects appear in the main list and can accept new work."
      : status === "PAUSED"
        ? "Paused projects keep their plan and history, but step out of the active list."
        : "Completed projects keep their evidence and stop accepting unfinished work until reopened.";

  async function saveChanges() {
    if (!dirty || !name.trim()) return;
    setSaving(true);
    await onSave({
      name,
      desiredOutcome,
      targetDate: targetDate || null,
      targetDurationValue: targetDurationValue
        ? Number(targetDurationValue)
        : null,
      targetDurationUnit: targetDurationValue ? targetDurationUnit : null,
      weeklyMinutesBudget: weeklyMinutesBudget ? Number(weeklyMinutesBudget) : null,
      status,
      confirm: status === "COMPLETED"
    });
    setSaving(false);
  }

  return (
    <div
      className="project-dialog-overlay project-edit-overlay"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        className="project-create-dialog project-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${project.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow focus-eyebrow">Edit project</span>
            <h2>{project.name}</h2>
          </div>
          <span className={dirty ? "project-unsaved dirty" : "project-unsaved"}>
            {dirty ? "Unsaved changes" : "No changes"}
          </span>
        </header>
        <div className="project-dialog-body project-edit-form">
          <div className="project-form-grid">
            <label>
              <span className="project-field-label">
                Name
                <SaveStateChip
                  state={nameSave.state}
                  onRetry={() => void nameSave.flush(true)}
                />
              </span>
              <input
                autoFocus
                value={name}
                onChange={(event) => nameSave.setDraft(event.target.value)}
                {...nameSave.inputProps}
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

          <fieldset className="project-state-control">
            <legend>State</legend>
            <div>
              {(["ACTIVE", "PAUSED", "COMPLETED"] as ProjectStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={status === value ? "active" : ""}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {projectStatusLabel(value)}
                </button>
              ))}
            </div>
            <p>{statusCopy}</p>
          </fieldset>

          <section className="project-contents-summary">
            <span className="eyebrow">What this project contains</span>
            <div>
              <strong>{project.taskCount} tasks</strong>
              <strong>{project.activities.length} records</strong>
              <strong>{project.notes.length} notes</strong>
              <strong>{project.materials.length} materials</strong>
              <strong>{project.phaseCount} phases</strong>
            </div>
          </section>

          <section className="project-remove-disclosure">
            <button
              type="button"
              className="project-remove-toggle"
              aria-expanded={removeOpen}
              onClick={() => setRemoveOpen((open) => !open)}
            >
              <span>Remove this project</span>
              {removeOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {removeOpen && (
              <div className="project-remove-options">
                <div>
                  <span>
                    <strong>Archive</strong>
                    <small>Keeps everything and hides the project from the active list.</small>
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onSave({ status: "ARCHIVED" })}
                  >
                    <Archive size={14} />
                    Archive project
                  </button>
                </div>
                <div>
                  <span>
                    <strong>Delete</strong>
                    <small>Deletes the container only. Tasks and evidence survive.</small>
                  </span>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 size={14} />
                    Delete project
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
        <footer>
          <button className="text-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!dirty || !name.trim() || saving}
            onClick={() => void saveChanges()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </section>

      {deleteConfirmOpen && (
        <div
          className="project-delete-confirm-overlay"
          role="presentation"
          onMouseDown={() => setDeleteConfirmOpen(false)}
        >
          <section
            className="project-delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Delete ${project.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Delete the project, keep the work</span>
            <h2>Delete “{project.name}”?</h2>
            <ul>
              <li>Tasks become standalone.</li>
              <li>Recorded time stays in Log.</li>
              <li>Notes and materials become unlinked.</li>
              <li>
                {project.phaseCount}{" "}
                {project.phaseCount === 1 ? "phase is" : "phases are"} destroyed.
              </li>
            </ul>
            <div>
              <button
                className="primary-button project-delete-confirm-button"
                onClick={() => void onDelete()}
              >
                Delete the container
              </button>
              <button
                className="secondary-button"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Keep the project
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProjectPhaseSection({
  title,
  tasks,
  phases,
  phase,
  today,
  collapsed = false,
  canManagePlan,
  onToggle,
  onUpdate,
  onDelete,
  onStartFocus,
  onPhaseSaved,
  onDeletePhase,
  onError
}: {
  title: string;
  tasks: ProjectTaskRecord[];
  phases: ProjectPhaseRecord[];
  phase?: ProjectPhaseRecord;
  today: string;
  collapsed?: boolean;
  canManagePlan: boolean;
  onToggle?: () => void;
  onUpdate: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
    plannedMinutes?: number;
  }) => void;
  onPhaseSaved?: () => Promise<void>;
  onDeletePhase?: (id: string) => Promise<boolean>;
  onError?: (error: string) => void;
}) {
  const metrics = calculateProjectMetrics(tasks);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const keepPhaseRef = useRef<HTMLButtonElement>(null);

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false);
    setDeleteFailed(false);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    keepPhaseRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || deleting) return;
      event.preventDefault();
      closeDeleteConfirm();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteConfirmOpen, deleting]);

  return (
    <section className="project-phase-section">
      <div className="phase-header">
        {phase && onPhaseSaved && onError ? (
          <EditablePhaseName phase={phase} onSaved={onPhaseSaved} onError={onError} />
        ) : (
          <strong>{title}</strong>
        )}
        <span>
          {metrics.taskCount
            ? `${metrics.completedTaskCount}/${metrics.taskCount}`
            : "0/0"}
        </span>
        <i className="phase-rule" />
        {phase && canManagePlan && onDeletePhase && (
          <button
            ref={deleteTriggerRef}
            className="phase-delete"
            title={`Delete phase ${phase.name}`}
            aria-label={`Delete phase ${phase.name}`}
            onClick={() => {
              setDeleteFailed(false);
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
        {phase && onToggle && (
          <button
            className="phase-collapse"
            aria-label={`${collapsed ? "Expand" : "Collapse"} phase ${phase.name}`}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        )}
      </div>
      {!collapsed &&
        (tasks.length ? (
          <TaskGroup
            tasks={tasks}
            phases={phases}
            today={today}
            canManagePlan={canManagePlan}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onStartFocus={onStartFocus}
          />
        ) : (
          <p className="phase-empty">No tasks in this phase yet.</p>
        ))}
      {phase && onDeletePhase && deleteConfirmOpen && (
        <div
          className="project-delete-confirm-overlay"
          role="presentation"
          onMouseDown={deleting ? undefined : closeDeleteConfirm}
        >
          <section
            className="project-delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Delete phase ${phase.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Delete phase</span>
            <h2>Delete “{phase.name}”?</h2>
            <p>
              Its {tasks.length} {tasks.length === 1 ? "Task" : "Tasks"} will be
              preserved and moved to the Project root.
            </p>
            {deleteFailed && (
              <p className="project-confirm-error" role="alert">
                Phase could not be deleted. Try again.
              </p>
            )}
            <div>
              <button
                className="primary-button project-delete-confirm-button"
                disabled={deleting}
                onClick={async () => {
                  setDeleteFailed(false);
                  setDeleting(true);
                  const deleted = await onDeletePhase(phase.id);
                  setDeleting(false);
                  if (deleted) setDeleteConfirmOpen(false);
                  else setDeleteFailed(true);
                }}
              >
                {deleting ? "Deleting…" : "Delete phase"}
              </button>
              <button
                ref={keepPhaseRef}
                className="secondary-button"
                disabled={deleting}
                onClick={closeDeleteConfirm}
              >
                Keep phase
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function TaskGroup({
  tasks,
  phases,
  today,
  canManagePlan,
  onUpdate,
  onDelete,
  onStartFocus
}: {
  tasks: ProjectTaskRecord[];
  phases: ProjectPhaseRecord[];
  today: string;
  canManagePlan: boolean;
  onUpdate: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
    plannedMinutes?: number;
  }) => void;
}) {
  return (
    <div className="project-task-list">
      {sortTasks(tasks).map((task) => (
        <ProjectTaskItem
          key={task.id}
          task={task}
          phases={phases}
          today={today}
          canManagePlan={canManagePlan}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onStartFocus={onStartFocus}
        />
      ))}
    </div>
  );
}

function ProjectTaskItem({
  task,
  phases,
  today,
  canManagePlan,
  onUpdate,
  onDelete,
  onStartFocus
}: {
  task: ProjectTaskRecord;
  phases: ProjectPhaseRecord[];
  today: string;
  canManagePlan: boolean;
  onUpdate: (
    id: string,
    patch: Partial<ProjectTaskRecord> & { scheduleSource?: string }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onStartFocus: (target: {
    taskId?: string;
    projectId?: string;
    label?: string;
    plannedMinutes?: number;
  }) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const keepTaskRef = useRef<HTMLButtonElement>(null);
  const backlog = !task.date && task.status !== "DONE";
  const done = task.status === "DONE";

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false);
    setDeleteFailed(false);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  }

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => {
    if (!deleteConfirmOpen) return;
    keepTaskRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || deleting) return;
      event.preventDefault();
      closeDeleteConfirm();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteConfirmOpen, deleting]);

  return (
    <article
      className={[
        "project-task",
        phases.length > 0 ? "has-phase-options" : "",
        backlog ? "backlog" : "",
        done ? "done" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="check-button"
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() =>
          void onUpdate(task.id, { status: done ? "TODO" : "DONE" })
        }
      >
        {done ? <Check size={15} /> : <Circle size={15} />}
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
      {phases.length > 0 && (
        <select
          className="project-task-phase"
          value={task.phaseId ?? ""}
          disabled={!canManagePlan}
          aria-label={`Phase for ${task.title}`}
          onChange={(event) =>
            void onUpdate(task.id, { phaseId: event.target.value || null })
          }
        >
          <option value="">No phase</option>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
      )}
      {done ? (
        <span className="project-task-state done">Done</span>
      ) : backlog ? (
        <span className="project-task-state backlog">Backlog</span>
      ) : (
        <button
          className="project-task-focus"
          onClick={() =>
            onStartFocus({
              taskId: task.id,
              projectId: task.projectId ?? undefined,
              label: task.title,
              plannedMinutes: task.estimateMinutes
            })
          }
        >
          <Play size={12} />
          Focus {task.estimateMinutes}m
        </button>
      )}
      {backlog ? (
        <label className="project-schedule-button">
          Schedule
          <input
            type="date"
            aria-label={`Schedule ${task.title}`}
            onChange={(event) => {
              if (event.target.value) {
                void onUpdate(task.id, {
                  date: event.target.value,
                  scheduleSource: "project-date-picker"
                });
              }
            }}
          />
        </label>
      ) : (
        <span className="project-task-meta">
          {task.date ? formatProjectTaskDate(task.date, today) : "completed"} ·{" "}
          {task.estimateMinutes}m
        </span>
      )}
      {task.deadline ? (
        <span className="project-task-deadline">
          due {formatShortDate(task.deadline)}
        </span>
      ) : (
        <span className="project-task-deadline-spacer" aria-hidden="true" />
      )}
      {canManagePlan && (
        <button
          ref={deleteTriggerRef}
          className="icon-button project-task-delete"
          title={`Delete task ${task.title}`}
          aria-label={`Delete task ${task.title}`}
          onClick={() => {
            setDeleteFailed(false);
            setDeleteConfirmOpen(true);
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
      {deleteConfirmOpen && (
        <div
          className="project-delete-confirm-overlay"
          role="presentation"
          onMouseDown={deleting ? undefined : closeDeleteConfirm}
        >
          <section
            className="project-delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Delete task ${task.title}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Delete task</span>
            <h2>Delete “{task.title}”?</h2>
            <p>This permanently removes the task.</p>
            {deleteFailed && (
              <p className="project-confirm-error" role="alert">
                Task could not be deleted. Try again.
              </p>
            )}
            <div>
              <button
                className="primary-button project-delete-confirm-button"
                disabled={deleting}
                onClick={async () => {
                  setDeleteFailed(false);
                  setDeleting(true);
                  const deleted = await onDelete(task.id);
                  setDeleting(false);
                  if (deleted) setDeleteConfirmOpen(false);
                  else setDeleteFailed(true);
                }}
              >
                {deleting ? "Deleting…" : "Delete task"}
              </button>
              <button
                ref={keepTaskRef}
                className="secondary-button"
                disabled={deleting}
                onClick={closeDeleteConfirm}
              >
                Keep task
              </button>
            </div>
          </section>
        </div>
      )}
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
  const nameSave = useSaveState({
    value: phase.name,
    save: async (name: string) => {
      const response = await fetch(`/api/phases/${phase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isProjectPhaseResponse(result) ||
        result.id !== phase.id ||
        result.name !== name
      ) {
        return false;
      }
      await onSaved();
      return true;
    },
    normalize: (value: string) => value.trim(),
    isValid: (value: string) => Boolean(value),
    onFinalError: () =>
      onError("Couldn’t save the phase name. Your text is still here — retry."),
    onRecovered: () => onError("")
  });

  return (
    <>
      <input
        className="phase-name-input"
        value={nameSave.draft}
        onChange={(event) => nameSave.setDraft(event.target.value)}
        aria-label={`Phase name: ${phase.name}`}
        {...nameSave.inputProps}
      />
      <SaveStateChip
        state={nameSave.state}
        onRetry={() => void nameSave.flush(true)}
      />
    </>
  );
}

function ProjectEvidence({ detail }: { detail: ProjectDetail }) {
  return (
    <details className="project-evidence-details">
      <summary>
        Evidence · {detail.activities.length} activities, {detail.notes.length} notes,{" "}
        {detail.materials.length} references
      </summary>
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
    </details>
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

function formatProjectTaskDate(value: string, today: string) {
  return value.slice(0, 10) === today.slice(0, 10)
    ? "today"
    : formatShortDate(value);
}
