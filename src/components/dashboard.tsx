"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Expand,
  ExternalLink,
  FileText,
  FolderKanban,
  GripVertical,
  LayoutDashboard,
  Library,
  LinkIcon,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Shrink,
  Sparkles,
  Trash2
} from "lucide-react";
import { ProjectsWorkspace } from "@/components/projects-workspace";
import {
  FocusDraft,
  FocusSessionBanner,
  FocusTimer
} from "@/components/focus-timer";
import { useFocusSession } from "@/components/focus-session-provider";
import { ProjectSummary } from "@/lib/project-domain";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Section = "today" | "plan" | "journal" | "review";
type PlanView = "list" | "timeline" | "matrix" | "projects";
type JournalView = "diary" | "notes" | "materials";
type CaptureTarget = "task" | "project" | "activity" | "note" | "material";
type FocusTarget = Omit<FocusDraft, "revision">;

type Task = {
  id: string;
  title: string;
  date: string | null;
  status: TaskStatus;
  priority: Priority;
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

type Note = {
  id: string;
  content: string;
  tags: string[];
  taskId: string | null;
  projectId: string | null;
  date: string;
  createdAt: string;
};

type Diary = {
  id: string;
  date: string;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
};

type Material = {
  id: string;
  title: string;
  url: string;
  type: string;
  notes: string;
  taskId: string | null;
  projectId: string | null;
  createdAt: string;
};

type TimeBlock = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  taskId: string | null;
};

type ActivityEntry = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
  createdAt: string;
};

type DayStat = {
  day: string;
  completed: number;
  total: number;
  completionRate: number;
  plannedHours: number;
  actualHours: number;
  mood: number | null;
  energy: number | null;
};

type Bootstrap = {
  today: string;
  tasks: Task[];
  notes: Note[];
  diary: Diary;
  materials: Material[];
  timeBlocks: TimeBlock[];
  activities: ActivityEntry[];
  projects: ProjectSummary[];
  unfinishedTasks: Task[];
  stats: DayStat[];
};

const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "review", label: "Review", icon: Sparkles }
] satisfies Array<{ id: Section; label: string; icon: typeof LayoutDashboard }>;

const priorityLabel: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High"
};

const statusLabel: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done"
};

const activityCategories = ["Deep Work", "Learning", "Admin", "Health", "Rest"];

export function Dashboard() {
  const { activityRevision } = useFocusSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [active, setActive] = useState<Section>("today");
  const [planView, setPlanView] = useState<PlanView>("list");
  const [journalView, setJournalView] = useState<JournalView>("diary");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activityComposerOpen, setActivityComposerOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newNote, setNewNote] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [materialProjectId, setMaterialProjectId] = useState("");
  const [activityTime, setActivityTime] = useState("");
  const [activityDuration, setActivityDuration] = useState("30");
  const [activityCategory, setActivityCategory] = useState(activityCategories[0]);
  const [activityTaskId, setActivityTaskId] = useState("");
  const [activityProjectId, setActivityProjectId] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [activityError, setActivityError] = useState("");
  const [compactMode, setCompactMode] = useState(false);
  const [savingDiary, setSavingDiary] = useState(false);
  const [noteProjectId, setNoteProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [dismissedUnfinished, setDismissedUnfinished] = useState<string[]>([]);
  const [scheduleUndoTaskId, setScheduleUndoTaskId] = useState<string | null>(null);
  const [focusDraft, setFocusDraft] = useState<FocusDraft | null>(null);

  useEffect(() => {
    setActivityTime(formatTimeInput(new Date()));
    void refresh();
  }, []);

  useEffect(() => {
    if (activityRevision > 0) void refresh();
  }, [activityRevision]);

  async function refresh() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    setData(await response.json());
  }

  const todayTasks = useMemo(() => {
    if (!data) return [];
    const key = data.today.slice(0, 10);
    return data.tasks
      .filter((task) => task.date?.slice(0, 10) === key)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  const futureTasks = useMemo(() => {
    if (!data) return [];
    const key = data.today.slice(0, 10);
    return data.tasks.filter((task) => task.date && task.date.slice(0, 10) > key);
  }, [data]);

  const planningTasks = useMemo(
    () => [...todayTasks, ...futureTasks].filter((task) => task.status !== "DONE"),
    [futureTasks, todayTasks]
  );

  const generalBacklogTasks = useMemo(
    () =>
      (data?.tasks ?? []).filter(
        (task) => !task.date && !task.projectId && task.status !== "DONE"
      ),
    [data]
  );

  const openTodayTasks = useMemo(
    () => todayTasks.filter((task) => task.status !== "DONE"),
    [todayTasks]
  );

  const completedTodayTasks = useMemo(
    () => todayTasks.filter((task) => task.status === "DONE"),
    [todayTasks]
  );

  const todayActivities = useMemo(() => data?.activities ?? [], [data]);
  const selectedActivityTask = useMemo(
    () => todayTasks.find((task) => task.id === activityTaskId) ?? null,
    [activityTaskId, todayTasks]
  );

  const projectById = useMemo(
    () => new Map((data?.projects ?? []).map((project) => [project.id, project])),
    [data]
  );

  const visibleUnfinishedTasks = useMemo(
    () =>
      (data?.unfinishedTasks ?? []).filter(
        (task) => !dismissedUnfinished.includes(task.id)
      ),
    [data, dismissedUnfinished]
  );

  const movedProjects = useMemo(() => {
    if (!data) return [];
    const weekStart = new Date(data.today);
    weekStart.setDate(weekStart.getDate() - 6);
    return data.projects.filter(
      (project) => project.lastProgressAt && new Date(project.lastProgressAt) >= weekStart
    );
  }, [data]);

  const summary = useMemo(() => {
    const completed = todayTasks.filter((task) => task.status === "DONE").length;
    const estimate = todayTasks.reduce((sum, task) => sum + task.estimateMinutes, 0);
    const recordedMinutes = todayActivities.reduce(
      (sum, activity) => sum + activity.durationMinutes,
      0
    );
    const legacyActualMinutes = todayTasks.reduce((sum, task) => sum + task.actualMinutes, 0);
    const actual = todayActivities.length ? recordedMinutes : legacyActualMinutes;
    return {
      completed,
      total: todayTasks.length,
      rate: todayTasks.length ? Math.round((completed / todayTasks.length) * 100) : 0,
      estimate,
      actual
    };
  }, [todayActivities, todayTasks]);

  async function addTask() {
    if (!newTask.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask, estimateMinutes: 30 })
    });
    setNewTask("");
    await refresh();
  }

  async function updateTask(id: string, patch: Partial<Task> & { scheduleSource?: string }) {
    const { scheduleSource: _scheduleSource, ...taskPatch } = patch;
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id ? { ...task, ...taskPatch } : task
            )
          }
        : current
    );
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error("Task could not be saved.");
      await refresh();
      return true;
    } catch {
      await refresh();
      return false;
    }
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function reorderTask(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const oldIndex = todayTasks.findIndex((task) => task.id === draggedId);
    const newIndex = todayTasks.findIndex((task) => task.id === targetId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = [...todayTasks];
    const [item] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, item);

    // Optimistic update
    setData((current) => current ? { ...current, tasks: current.tasks.map(t => {
      const found = reordered.find(r => r.id === t.id);
      return found ? { ...t, sortOrder: reordered.indexOf(found) } : t;
    }) } : current);

    await fetch("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((task) => task.id) })
    });
    await refresh();
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newNote,
        projectId: noteProjectId || null,
        tags: noteTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      })
    });
    setNewNote("");
    setNoteTags("");
    setNoteProjectId("");
    await refresh();
  }

  async function saveDiary(patch?: Partial<Diary>) {
    if (!data) return;
    setSavingDiary(true);
    await fetch("/api/diary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data.diary, ...patch })
    });
    setSavingDiary(false);
    await refresh();
  }

  async function addMaterial() {
    if (!materialUrl.trim()) return;
    await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: materialTitle,
        url: materialUrl,
        notes: materialNotes,
        projectId: materialProjectId || null
      })
    });
    setMaterialTitle("");
    setMaterialUrl("");
    setMaterialNotes("");
    setMaterialProjectId("");
    await refresh();
  }

  async function addActivity() {
    const durationMinutes = Number(activityDuration);
    if (!activityNote.trim()) {
      setActivityError("Add a short note about what happened.");
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      setActivityError("Duration must be between 1 and 1440 minutes.");
      return;
    }

    setActivityError("");
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: data?.today,
        startTime: activityTime,
        durationMinutes,
        category: activityCategory,
        taskId: activityTaskId || null,
        projectId: activityProjectId || null,
        note: activityNote
      })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setActivityError(result?.error ?? "Activity could not be saved.");
      return;
    }

    setActivityNote("");
    setActivityTaskId("");
    setActivityProjectId("");
    setActivityTime(formatTimeInput(new Date()));
    setActivityComposerOpen(false);
    await refresh();
  }

  async function deleteActivity(id: string) {
    await fetch(`/api/activities/${id}`, { method: "DELETE" });
    await refresh();
  }

  function setDiaryValue<K extends keyof Diary>(key: K, value: Diary[K]) {
    setData((current) =>
      current ? { ...current, diary: { ...current.diary, [key]: value } } : current
    );
  }

  function openCapture(target: CaptureTarget) {
    const destination: Record<CaptureTarget, { section: Section; field: string }> = {
      task: { section: "today", field: "new-task" },
      project: { section: "plan", field: "new-project-name" },
      activity: { section: "today", field: "activity-note" },
      note: { section: "journal", field: "new-note" },
      material: { section: "journal", field: "material-url" }
    };

    if (target === "note") setJournalView("notes");
    if (target === "material") setJournalView("materials");
    if (target === "activity") setActivityComposerOpen(true);
    if (target === "project") {
      setPlanView("projects");
      setSelectedProjectId(null);
      setProjectCreateOpen(true);
    }
    setActive(destination[target].section);
    setCaptureOpen(false);
    setToolsOpen(false);
    window.setTimeout(() => document.getElementById(destination[target].field)?.focus(), 0);
  }

  function openProject(id: string) {
    setSelectedProjectId(id);
    setPlanView("projects");
    setActive("plan");
    setCaptureOpen(false);
    setToolsOpen(false);
  }

  function openFocus(target: FocusTarget) {
    setFocusDraft({ ...target, revision: Date.now() });
    setActive("today");
    setCaptureOpen(false);
    setToolsOpen(false);
    window.setTimeout(
      () => document.getElementById("focus-timer-title")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      }),
      0
    );
  }

  async function resolveUnfinishedTask(id: string, date: string | null, source: string) {
    await updateTask(id, { date, scheduleSource: source });
    setScheduleUndoTaskId(id);
  }

  async function undoScheduleChange(id: string) {
    await fetch(`/api/tasks/${id}/schedule/undo`, { method: "POST" });
    setScheduleUndoTaskId(null);
    await refresh();
  }

  if (!data) {
    return (
      <main className="loading-screen">
        <RefreshCw className="spin" size={22} />
        <span>Opening Dayflow</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <strong>Dayflow</strong>
            <span>Local notebook</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={active === item.id ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setActive(item.id);
                  setCaptureOpen(false);
                  setToolsOpen(false);
                }}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <p className="sidebar-note">Decide. Do. Capture. Review.</p>
      </aside>

      <section className={compactMode ? "workspace compact-mode" : "workspace"}>
        <header className="topbar">
          <div className="page-intro">
            <p className="date-line">{formatLongDate(data.today)}</p>
            <h1>{headlineFor(active)}</h1>
          </div>
          <div className="topbar-actions">
            <div className="menu-anchor">
              <button
                className="capture-button"
                aria-expanded={captureOpen}
                onClick={() => {
                  setCaptureOpen((open) => !open);
                  setToolsOpen(false);
                }}
              >
                <Plus size={16} />
                Capture
              </button>
              {captureOpen && (
                <div className="action-menu capture-menu" aria-label="Capture options">
                  <button onClick={() => openCapture("task")}>New task</button>
                  <button onClick={() => openCapture("project")}>New project</button>
                  <button onClick={() => openCapture("activity")}>Record activity</button>
                  <button onClick={() => openCapture("note")}>Write note</button>
                  <button onClick={() => openCapture("material")}>Save reference</button>
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="icon-button"
                aria-label="Open tools"
                aria-expanded={toolsOpen}
                onClick={() => {
                  setToolsOpen((open) => !open);
                  setCaptureOpen(false);
                }}
              >
                <Settings2 size={17} />
              </button>
              {toolsOpen && (
                <div className="action-menu tools-menu" aria-label="Tools">
                  <button
                    title="Toggle compact mode"
                    onClick={() => {
                      setCompactMode((compact) => !compact);
                      setToolsOpen(false);
                    }}
                  >
                    {compactMode ? <Expand size={16} /> : <Shrink size={16} />}
                    {compactMode ? "Comfortable density" : "Compact density"}
                  </button>
                  <a href="/api/agent-export" target="_blank">
                    <Sparkles size={16} />
                    Agent export
                  </a>
                  <span>More data tools will live here.</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {active !== "today" && (
          <FocusSessionBanner
            onOpenToday={() => {
              setActive("today");
              window.setTimeout(
                () => document.getElementById("focus-timer-title")?.scrollIntoView({
                  behavior: "smooth",
                  block: "center"
                }),
                0
              );
            }}
          />
        )}

        {active === "today" && (
          <div className="today-layout">
            <section className="panel task-panel">
              <PanelTitle icon={<Check size={18} />} title="Today" detail={`${summary.completed}/${summary.total} done`} />
              {visibleUnfinishedTasks.length > 0 && (
                <UnfinishedTray
                  tasks={visibleUnfinishedTasks}
                  projects={projectById}
                  today={data.today}
                  onResolve={resolveUnfinishedTask}
                  onLeave={(id) =>
                    setDismissedUnfinished((current) => [...current, id])
                  }
                />
              )}
              {scheduleUndoTaskId && (
                <div className="schedule-undo">
                  <span>Task schedule updated.</span>
                  <button
                    className="text-button"
                    onClick={() => void undoScheduleChange(scheduleUndoTaskId)}
                  >
                    <RefreshCw size={14} />
                    Undo
                  </button>
                </div>
              )}
              <div className="task-input-row">
                <input
                  id="new-task"
                  value={newTask}
                  onChange={(event) => setNewTask(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addTask();
                  }}
                  placeholder="Add a task for today"
                />
                <button className="primary-button" onClick={() => void addTask()}>
                  <Plus size={16} />
                  Add
                </button>
              </div>
              <div className="task-list">
                {openTodayTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onUpdate={updateTask}
                    onDelete={deleteTask}
                    onReorder={reorderTask}
                    project={task.projectId ? projectById.get(task.projectId) : undefined}
                    projects={data.projects}
                    onOpenProject={openProject}
                    onStartFocus={(task) =>
                      openFocus({
                        taskId: task.id,
                        projectId: task.projectId ?? undefined,
                        label: task.title
                      })
                    }
                  />
                ))}
                {!openTodayTasks.length && !completedTodayTasks.length && (
                  <div className="quiet-empty">
                    <strong>Your day is open.</strong>
                    <span>Add one thing that would make today feel complete.</span>
                  </div>
                )}
              </div>
              {completedTodayTasks.length > 0 && (
                <details className="completed-group">
                  <summary>Completed · {completedTodayTasks.length}</summary>
                  <div className="task-list completed-list">
                    {completedTodayTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onUpdate={updateTask}
                        onDelete={deleteTask}
                        onReorder={reorderTask}
                        project={task.projectId ? projectById.get(task.projectId) : undefined}
                        projects={data.projects}
                        onOpenProject={openProject}
                        onStartFocus={(task) =>
                          openFocus({
                            taskId: task.id,
                            projectId: task.projectId ?? undefined,
                            label: task.title
                          })
                        }
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>

            <div className="today-side">
              <section className="pulse-strip" aria-label="Daily pulse">
                <div className="pulse-heading">
                  <div>
                    <Clock3 size={18} />
                    <h2>Daily pulse</h2>
                  </div>
                  <span>{summary.rate}% complete</span>
                </div>
                <div className="pulse-grid">
                  <Metric label="Planned" value={`${summary.estimate}m`} />
                  <Metric label="Spent" value={`${summary.actual}m`} />
                  <Metric label="Energy" value={`${data.diary.energy}/5`} />
                  <Metric label="Mood" value={`${data.diary.mood}/5`} />
                </div>
              </section>

              <FocusTimer
                tasks={data.tasks.filter((task) => task.status !== "DONE")}
                projects={data.projects}
                today={data.today}
                draft={focusDraft}
              />

              <section className="panel activity-panel">
                <PanelTitle
                  icon={<Clock3 size={18} />}
                  title="Activity"
                  detail={`${summary.actual}m recorded`}
                />
                <details
                  className="composer"
                  open={activityComposerOpen}
                  onToggle={(event) => setActivityComposerOpen(event.currentTarget.open)}
                >
                  <summary>
                    <Plus size={15} />
                    Record activity
                  </summary>
                  <div className="activity-form">
                    <textarea
                      id="activity-note"
                      value={activityNote}
                      onChange={(event) => {
                        setActivityNote(event.target.value);
                        if (activityError) setActivityError("");
                      }}
                      placeholder="Record a small win or what moved forward."
                    />
                    <div className="activity-form-grid">
                      <label>
                        Minutes
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          step="5"
                          value={activityDuration}
                          onChange={(event) => setActivityDuration(event.target.value)}
                        />
                      </label>
                      <label>
                        Category
                        <select
                          value={activityCategory}
                          onChange={(event) => setActivityCategory(event.target.value)}
                        >
                          {activityCategories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="activity-form-grid secondary-fields">
                      <label>
                        Time
                        <input
                          type="time"
                          value={activityTime}
                          onChange={(event) => setActivityTime(event.target.value)}
                        />
                      </label>
                      <label className="activity-task-field">
                        Linked task
                        <select
                          value={activityTaskId}
                          onChange={(event) => {
                            const taskId = event.target.value;
                            setActivityTaskId(taskId);
                            const task = todayTasks.find((item) => item.id === taskId);
                            if (task?.projectId) setActivityProjectId("");
                          }}
                        >
                          <option value="">No linked task</option>
                          {todayTasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="activity-project-field">
                        Project
                        <select
                          value={
                            selectedActivityTask?.projectId ?? activityProjectId
                          }
                          disabled={Boolean(selectedActivityTask?.projectId)}
                          onChange={(event) => setActivityProjectId(event.target.value)}
                        >
                          <option value="">No linked project</option>
                          {data.projects
                            .filter((project) => project.status !== "ARCHIVED")
                            .map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {activityError && <p className="form-error">{activityError}</p>}
                    <button className="secondary-button" onClick={() => void addActivity()}>
                      <Plus size={16} />
                      Add activity
                    </button>
                  </div>
                </details>
                <ActivityList
                  activities={todayActivities}
                  tasks={todayTasks}
                  projects={projectById}
                  onDelete={deleteActivity}
                />
              </section>
            </div>
          </div>
        )}

        {active === "plan" && (
          <div className="section-stack">
            <div className="view-switcher" role="tablist" aria-label="Planning view">
              {(["list", "timeline", "matrix", "projects"] as PlanView[]).map((view) => (
                <button
                  key={view}
                  className={planView === view ? "active" : ""}
                  aria-selected={planView === view}
                  role="tab"
                  onClick={() => setPlanView(view)}
                >
                  {view === "list" ? "Tasks" : `${view[0].toUpperCase()}${view.slice(1)}`}
                </button>
              ))}
            </div>
            {planView === "list" && (
              <section className="panel focused-panel">
                <PanelTitle icon={<Circle size={18} />} title="What comes next" detail={`${planningTasks.length} open`} />
                <TaskCompactList tasks={planningTasks} />
                <div className="plan-backlog">
                  <div>
                    <strong>Backlog</strong>
                    <span>{generalBacklogTasks.length} unscheduled</span>
                  </div>
                  <BacklogList tasks={generalBacklogTasks} onUpdate={updateTask} />
                </div>
              </section>
            )}
            {planView === "timeline" && (
              <section className="panel focused-panel">
                <PanelTitle icon={<CalendarDays size={18} />} title="Timeline" detail="Today and tomorrow" />
                <MiniTimeline blocks={data.timeBlocks} tasks={data.tasks} today={data.today} expanded />
              </section>
            )}
            {planView === "matrix" && (
              <section className="panel matrix-panel focused-panel">
                <PanelTitle icon={<LayoutDashboard size={18} />} title="Urgency and importance" detail="Optional planning tool" />
                <UrgencyImportanceMatrix tasks={planningTasks} today={data.today} onUpdate={updateTask} />
              </section>
            )}
            {planView === "projects" && (
              <ProjectsWorkspace
                projects={data.projects}
                selectedProjectId={selectedProjectId}
                createOpen={projectCreateOpen}
                today={data.today}
                onSelectedProjectChange={setSelectedProjectId}
                  onCreateOpenChange={setProjectCreateOpen}
                  onDataChanged={refresh}
                  onStartFocus={openFocus}
                />
            )}
          </div>
        )}

        {active === "journal" && (
          <div className="section-stack">
            <div className="view-switcher" role="tablist" aria-label="Journal view">
              {(["diary", "notes", "materials"] as JournalView[]).map((view) => (
                <button
                  key={view}
                  className={journalView === view ? "active" : ""}
                  aria-selected={journalView === view}
                  role="tab"
                  onClick={() => setJournalView(view)}
                >
                  {`${view[0].toUpperCase()}${view.slice(1)}`}
                </button>
              ))}
            </div>
            {journalView === "diary" && (
              <section className="panel journal-editor focused-panel">
                <PanelTitle icon={<BookOpen size={18} />} title="Daily page" detail={savingDiary ? "Saving" : "Today"} />
                <textarea
                  className="large-textarea"
                  value={data.diary.content}
                  onChange={(event) => setDiaryValue("content", event.target.value)}
                  placeholder="Write a few lines about the day."
                />
                <div className="range-row">
                  <label>
                    Mood · {data.diary.mood}/5
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={data.diary.mood}
                      onChange={(event) => setDiaryValue("mood", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    Energy · {data.diary.energy}/5
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={data.diary.energy}
                      onChange={(event) => setDiaryValue("energy", Number(event.target.value))}
                    />
                  </label>
                  <button className="primary-button" onClick={() => void saveDiary()}>
                    <Save size={16} />
                    Save
                  </button>
                </div>
              </section>
            )}
            {journalView === "notes" && (
              <TwoColumnView
                left={
                  <section className="panel">
                    <PanelTitle icon={<NotebookPen size={18} />} title="Notes" detail={`${data.notes.length} saved`} />
                    <NoteList notes={data.notes} projects={projectById} />
                  </section>
                }
                right={
                  <section className="panel">
                    <PanelTitle icon={<Plus size={18} />} title="New note" detail="Quick capture" />
                    <div className="note-input">
                      <textarea
                        id="new-note"
                        value={newNote}
                        onChange={(event) => setNewNote(event.target.value)}
                        placeholder="Capture a thought, decision, or reminder."
                      />
                      <input
                        value={noteTags}
                        onChange={(event) => setNoteTags(event.target.value)}
                        placeholder="Tags, comma separated"
                      />
                      <select
                        value={noteProjectId}
                        onChange={(event) => setNoteProjectId(event.target.value)}
                        aria-label="Note project"
                      >
                        <option value="">No linked project</option>
                        {data.projects
                          .filter((project) => project.status !== "ARCHIVED")
                          .map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                      </select>
                      <button className="primary-button" onClick={() => void addNote()}>
                        <Plus size={16} />
                        Save note
                      </button>
                    </div>
                  </section>
                }
              />
            )}
            {journalView === "materials" && (
              <TwoColumnView
                left={
                  <section className="panel">
                    <PanelTitle icon={<Library size={18} />} title="References" detail={`${data.materials.length} saved`} />
                    <MaterialList materials={data.materials} projects={projectById} />
                  </section>
                }
                right={
                  <section className="panel">
                    <PanelTitle icon={<LinkIcon size={18} />} title="Save reference" detail="Link with context" />
                    <div className="material-form roomy">
                      <input value={materialTitle} onChange={(event) => setMaterialTitle(event.target.value)} placeholder="Title" />
                      <input id="material-url" value={materialUrl} onChange={(event) => setMaterialUrl(event.target.value)} placeholder="URL" />
                      <textarea value={materialNotes} onChange={(event) => setMaterialNotes(event.target.value)} placeholder="Why this matters" />
                      <select
                        value={materialProjectId}
                        onChange={(event) => setMaterialProjectId(event.target.value)}
                        aria-label="Reference project"
                      >
                        <option value="">No linked project</option>
                        {data.projects
                          .filter((project) => project.status !== "ARCHIVED")
                          .map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                      </select>
                      <button className="primary-button" onClick={() => void addMaterial()}>
                        <Plus size={16} />
                        Save reference
                      </button>
                    </div>
                  </section>
                }
              />
            )}
          </div>
        )}

        {active === "review" && (
          <div className="review-page">
            <div className="two-column review-summary">
              <section className="panel">
                <PanelTitle icon={<Sparkles size={18} />} title="Today reviewed" detail={`${summary.completed} completed`} />
                <div className="review-stack">
                  <Metric label="Completion" value={`${summary.rate}%`} />
                  <Metric label="Remaining" value={`${Math.max(summary.total - summary.completed, 0)}`} />
                  <Metric label="Actual time" value={`${summary.actual}m`} />
                </div>
                <TaskCompactList tasks={todayTasks.filter((task) => task.status !== "DONE")} />
              </section>
              <section className="panel">
                <PanelTitle icon={<FileText size={18} />} title="Reflection" detail="Plan tomorrow" />
                <textarea
                  className="large-textarea"
                  value={data.diary.reflection}
                  onChange={(event) => setDiaryValue("reflection", event.target.value)}
                  placeholder="What worked, what needs attention, and what should move to tomorrow?"
                />
                <button className="primary-button wide" onClick={() => void saveDiary()}>
                  <Save size={16} />
                  Save reflection
                </button>
              </section>
            </div>
            <section className="panel project-review-panel">
              <PanelTitle
                icon={<FolderKanban size={18} />}
                title="Projects moved forward"
                detail={`${movedProjects.length} this week`}
              />
              {movedProjects.length ? (
                <div className="project-review-list">
                  {movedProjects.slice(0, 5).map((project) => (
                    <button key={project.id} onClick={() => openProject(project.id)}>
                      <span>{project.name}</span>
                      <small>
                        {project.completedTaskCount}/{project.taskCount} tasks ·{" "}
                        {project.investedMinutes}m invested
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">
                  Record an activity or complete a Project task to make progress visible here.
                </p>
              )}
            </section>
            <section className="panel insights-panel">
              <PanelTitle icon={<LayoutDashboard size={18} />} title="Seven-day view" detail="Patterns, not pressure" />
              <Charts stats={data.stats} />
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function UnfinishedTray({
  tasks,
  projects,
  today,
  onResolve,
  onLeave
}: {
  tasks: Task[];
  projects: Map<string, ProjectSummary>;
  today: string;
  onResolve: (id: string, date: string | null, source: string) => Promise<void>;
  onLeave: (id: string) => void;
}) {
  return (
    <details className="unfinished-tray" open>
      <summary>
        <span>
          <RefreshCw size={15} />
          {tasks.length} unfinished {tasks.length === 1 ? "task" : "tasks"}
        </span>
        <small>Choose what should happen</small>
      </summary>
      <div className="unfinished-list">
        {tasks.map((task) => {
          const project = task.projectId ? projects.get(task.projectId) : null;
          return (
            <article key={task.id}>
              <div className="unfinished-copy">
                <strong>{task.title}</strong>
                <span>
                  {task.date ? formatShortDate(task.date) : "Previously scheduled"}
                  {project ? ` · ${project.name}` : ""}
                </span>
              </div>
              <div className="unfinished-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    void onResolve(task.id, today.slice(0, 10), "unfinished-to-today")
                  }
                >
                  Move to today
                </button>
                <label className="unfinished-date-action">
                  <span>Another day</span>
                  <input
                    type="date"
                    aria-label={`Choose another day for ${task.title}`}
                    onChange={(event) => {
                      if (event.target.value) {
                        void onResolve(task.id, event.target.value, "unfinished-date-picker");
                      }
                    }}
                  />
                </label>
                <button
                  className="text-button"
                  title="Move to the backlog by removing the scheduled date"
                  onClick={() => void onResolve(task.id, null, "unfinished-to-backlog")}
                >
                  Remove date
                </button>
                <button
                  className="text-button"
                  title="Keep the original date and hide this prompt until the page reloads"
                  onClick={() => onLeave(task.id)}
                >
                  {task.date ? `Keep on ${formatShortDate(task.date)}` : "Skip for now"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}

function TaskRow({
  task,
  onUpdate,
  onDelete,
  onReorder,
  project,
  projects,
  onOpenProject,
  onStartFocus
}: {
  task: Task;
  onUpdate: (id: string, patch: Partial<Task> & { scheduleSource?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (draggedId: string, targetId: string) => Promise<void>;
  project?: ProjectSummary;
  projects: ProjectSummary[];
  onOpenProject: (id: string) => void;
  onStartFocus: (task: Task) => void;
}) {
  const isDone = task.status === "DONE";
  const [isDraggable, setIsDraggable] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [titleSaveState, setTitleSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );

  useEffect(() => setTitleDraft(task.title), [task.title]);

  async function saveTitle() {
    const title = titleDraft.trim();
    if (!title) {
      setTitleDraft(task.title);
      setTitleSaveState("error");
      return;
    }
    if (title === task.title) return;
    setTitleSaveState("saving");
    const saved = await onUpdate(task.id, { title });
    setTitleSaveState(saved ? "saved" : "error");
    if (!saved) setTitleDraft(task.title);
  }

  return (
    <article
      className={isDone ? "task-row done" : "task-row"}
      aria-label={`Task: ${task.title}`}
      draggable={isDraggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== task.id) {
          void onReorder(draggedId, task.id);
        }
        setIsDraggable(false);
      }}
    >
      <button
        className="check-button"
        title={isDone ? "Mark incomplete" : "Complete task"}
        onClick={() => void onUpdate(task.id, { status: isDone ? "TODO" : "DONE" })}
      >
        {isDone ? <Check size={16} /> : <Circle size={16} />}
      </button>
      <div
        onMouseEnter={() => setIsDraggable(true)}
        onMouseLeave={() => setIsDraggable(false)}
        className="drag-handle"
      >
        <GripVertical className="drag-icon" size={16} />
      </div>
      <div className="task-title-editor">
        <input
          className="task-title-input"
          value={titleDraft}
          aria-label={`Task title: ${task.title}`}
          onChange={(event) => {
            setTitleDraft(event.target.value);
            setTitleSaveState("idle");
          }}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTitleDraft(task.title);
              setTitleSaveState("idle");
              event.currentTarget.blur();
            }
          }}
        />
        {titleSaveState !== "idle" && (
          <span
            className={`task-save-state ${titleSaveState}`}
            role="status"
            aria-live="polite"
          >
            {titleSaveState === "saving"
              ? "Saving"
              : titleSaveState === "saved"
                ? "Saved"
                : "Not saved"}
          </span>
        )}
      </div>
      <div className="task-glance">
        <span>
          {statusLabel[task.status]} · {task.estimateMinutes}m
          {task.deadline ? ` · ${formatShortDate(task.deadline)}` : ""}
        </span>
        {project && (
          <button
            className="project-chip"
            aria-label={`Open project ${project.name}`}
            onClick={() => onOpenProject(project.id)}
          >
            <FolderKanban size={12} />
            {project.name}
          </button>
        )}
      </div>
      <button
        className="icon-button task-details-toggle"
        aria-label={`${detailsOpen ? "Hide" : "Show"} task details: ${task.title}`}
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {detailsOpen && (
        <div className="task-details">
          <div className="task-controls">
            <label className="score-field">
              Urgency
              <ScoreDots
                value={task.urgentScore}
                tone="urgent"
                onChange={(value) => void onUpdate(task.id, { urgentScore: value })}
              />
            </label>
            <label className="score-field">
              Importance
              <ScoreDots
                value={task.importanceScore}
                tone="important"
                onChange={(value) => void onUpdate(task.id, { importanceScore: value })}
              />
            </label>
            <label>
              Deadline
              <input
                type="date"
                value={task.deadline ? task.deadline.slice(0, 10) : ""}
                onChange={(event) => void onUpdate(task.id, { deadline: event.target.value || null })}
              />
            </label>
            <label>
              Status
              <select value={task.status} onChange={(event) => void onUpdate(task.id, { status: event.target.value as TaskStatus })}>
                {Object.entries(statusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={task.projectId ?? ""}
                onChange={(event) =>
                  void onUpdate(task.id, {
                    projectId: event.target.value || null,
                    phaseId: null
                  })
                }
              >
                <option value="">No project</option>
                {projects
                  .filter(
                    (item) =>
                      (item.status !== "ARCHIVED" && item.status !== "COMPLETED") ||
                      item.id === task.projectId
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Estimate
              <input
                className="mini-number"
                type="number"
                min="5"
                step="5"
                value={task.estimateMinutes}
                onChange={(event) => void onUpdate(task.id, { estimateMinutes: Number(event.target.value) })}
                aria-label="Estimated minutes"
              />
            </label>
          </div>
          <div className="task-detail-actions">
            {!isDone && (
              <button className="text-button" onClick={() => onStartFocus(task)}>
                <Play size={15} />
                Start focus
              </button>
            )}
            <button
              className="text-button danger"
              aria-label={`Delete task: ${task.title}`}
              onClick={() => void onDelete(task.id)}
            >
              <Trash2 size={15} />
              Delete task
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ScoreDots({
  value,
  tone,
  onChange
}: {
  value: number;
  tone: "urgent" | "important";
  onChange: (value: number) => void;
}) {
  const label = tone === "urgent" ? "Urgency" : "Importance";

  return (
    <div className={`score-dots ${tone}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={`score-${score} ${score <= value ? "selected" : ""}`}
          aria-label={`${label} ${score} of 5`}
          aria-checked={score === value}
          role="radio"
          title={`${score} of 5`}
          onClick={() => onChange(score)}
        />
      ))}
    </div>
  );
}

function UrgencyImportanceMatrix({
  tasks,
  today,
  onUpdate,
  compact = false
}: {
  tasks: Task[];
  today: string;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<unknown>;
  compact?: boolean;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "DONE");

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task-id");
    if (!taskId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const urgentScore = coordinateToScore(x);
    const importanceScore = coordinateToScore(1 - y);
    void onUpdate(taskId, { urgentScore, importanceScore });
  }

  return (
    <div className={compact ? "matrix compact" : "matrix"}>
      <div className="matrix-y-label">Importance</div>
      <div className="matrix-x-label">Urgency</div>
      <div className="matrix-board" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <div className="quadrant q-plan">
          <strong>Schedule</strong>
          <span>Important, not urgent</span>
        </div>
        <div className="quadrant q-do">
          <strong>Do now</strong>
          <span>Important and urgent</span>
        </div>
        <div className="quadrant q-later">
          <strong>Later</strong>
          <span>Not urgent, less important</span>
        </div>
        <div className="quadrant q-delegate">
          <strong>Quick wins</strong>
          <span>Urgent, less important</span>
        </div>
        {activeTasks.map((task) => {
          const effectiveUrgency = effectiveUrgentScore(task, today);
          const x = scoreToCoordinate(effectiveUrgency);
          const y = 100 - scoreToCoordinate(task.importanceScore);
          const deadlineBoost = effectiveUrgency > task.urgentScore;
          return (
            <button
              key={task.id}
              className={deadlineBoost ? "matrix-task boosted" : "matrix-task"}
              draggable
              style={{ left: `${x}%`, top: `${y}%` }}
              title={deadlineBoost ? "Deadline moved this task into a more urgent slot" : "Drag to relabel urgency and importance"}
              onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}
            >
              {task.title}
              {deadlineBoost && <span>deadline</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function coordinateToScore(value: number) {
  return Math.min(5, Math.max(1, Math.round(value * 4 + 1)));
}

function scoreToCoordinate(score: number) {
  return ((Math.min(5, Math.max(1, score)) - 1) / 4) * 86 + 7;
}

function effectiveUrgentScore(task: Task, todayValue: string) {
  if (!task.deadline) return task.urgentScore;

  const today = new Date(todayValue);
  const deadline = new Date(task.deadline);
  const daysLeft = Math.ceil((startOfDayTime(deadline) - startOfDayTime(today)) / 86400000);
  const deadlineScore = daysLeft <= 1 ? 5 : daysLeft <= 3 ? 4 : daysLeft <= 7 ? 3 : daysLeft <= 14 ? 2 : 1;

  return Math.max(task.urgentScore, deadlineScore);
}

function startOfDayTime(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function PanelTitle({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="panel-title">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <span>{detail}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Charts({ stats }: { stats: DayStat[] }) {
  const chartData = stats.map((stat) => ({
    ...stat,
    label: new Date(`${stat.day}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })
  }));

  return (
    <div className="chart-grid">
      <div className="chart-box">
        <span>Completion</span>
        <ResponsiveContainer width="100%" height={145}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="completion" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#78906f" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#78906f" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eee8de" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis hide domain={[0, 100]} />
            <Tooltip />
            <Area type="monotone" dataKey="completionRate" stroke="#637a5c" fill="url(#completion)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <span>Tasks done</span>
        <ResponsiveContainer width="100%" height={145}>
          <BarChart data={chartData}>
            <CartesianGrid stroke="#eee8de" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} width={24} />
            <Tooltip />
            <Bar dataKey="completed" fill="#a8785c" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <span>Planned vs actual</span>
        <ResponsiveContainer width="100%" height={145}>
          <BarChart data={chartData}>
            <CartesianGrid stroke="#eee8de" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis width={24} />
            <Tooltip />
            <Bar dataKey="plannedHours" fill="#d4c6aa" radius={[5, 5, 0, 0]} />
            <Bar dataKey="actualHours" fill="#607d86" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <span>Mood and energy</span>
        <ResponsiveContainer width="100%" height={145}>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#eee8de" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis domain={[1, 5]} width={24} />
            <Tooltip />
            <Line type="monotone" dataKey="mood" stroke="#9b6f68" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="energy" stroke="#637a5c" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MiniTimeline({
  blocks,
  tasks,
  today,
  expanded = false
}: {
  blocks: TimeBlock[];
  tasks: Task[];
  today: string;
  expanded?: boolean;
}) {
  const todayKey = today.slice(0, 10);
  const visible = expanded ? blocks : blocks.filter((block) => block.date.slice(0, 10) === todayKey);

  return (
    <div className={expanded ? "timeline expanded" : "timeline"}>
      {visible.map((block) => {
        const task = tasks.find((item) => item.id === block.taskId);
        return (
          <div className="time-block" key={block.id}>
            <span>{block.startTime}</span>
            <div>
              <strong>{block.title}</strong>
              <small>{task?.title ?? formatShortDate(block.date)}</small>
            </div>
            <span>{block.endTime}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActivityList({
  activities,
  tasks,
  projects,
  onDelete
}: {
  activities: ActivityEntry[];
  tasks: Task[];
  projects: Map<string, ProjectSummary>;
  onDelete: (id: string) => Promise<void>;
}) {
  if (!activities.length) {
    return (
      <div className="activity-empty">
        <p>No activity recorded yet. Add one small piece of evidence from your day.</p>
      </div>
    );
  }

  return (
    <div className="activity-list">
      {activities.map((activity) => {
        const task = tasks.find((item) => item.id === activity.taskId);
        const project = task?.projectId
          ? projects.get(task.projectId)
          : activity.projectId
            ? projects.get(activity.projectId)
            : null;
        return (
          <article className="activity-item" key={activity.id}>
            <div className="activity-item-header">
              <div className="activity-meta">
                <time dateTime={activity.startedAt}>{formatActivityTime(activity.startedAt)}</time>
                <span>{activity.durationMinutes}m</span>
                <span className="activity-category">{activity.category}</span>
              </div>
              <button
                className="icon-button danger"
                title="Delete activity"
                aria-label={`Delete activity: ${activity.note}`}
                onClick={() => void onDelete(activity.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <p>{activity.note}</p>
            {(task || project) && (
              <small>
                {task ? `Linked to ${task.title}` : ""}
                {task && project ? " · " : ""}
                {project ? project.name : ""}
              </small>
            )}
          </article>
        );
      })}
    </div>
  );
}

function NoteList({
  notes,
  projects
}: {
  notes: Note[];
  projects: Map<string, ProjectSummary>;
}) {
  if (notes.length === 0) {
    return (
      <div className="empty-state">
        <NotebookPen size={32} />
        <p>No notes yet. Capture your thoughts and decisions above.</p>
      </div>
    );
  }
  return (
    <div className="note-list">
      {notes.map((note) => (
        <article key={note.id} className="note-card">
          <p>{note.content}</p>
          <div>
            {note.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
            {note.projectId && projects.get(note.projectId) && (
              <span className="linked-project">
                <FolderKanban size={11} />
                {projects.get(note.projectId)?.name}
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function MaterialList({
  materials,
  projects
}: {
  materials: Material[];
  projects: Map<string, ProjectSummary>;
}) {
  if (materials.length === 0) {
    return (
      <div className="empty-state">
        <Library size={32} />
        <p>Your library is empty. Save an article, video, or link above.</p>
      </div>
    );
  }
  return (
    <div className="material-list">
      {materials.map((material) => (
        <a href={material.url} target="_blank" rel="noreferrer" className="material-item" key={material.id}>
          <span>{material.type}</span>
          <strong>{material.title}</strong>
          <small>
            {material.notes || material.url}
            {material.projectId && projects.get(material.projectId)
              ? ` · ${projects.get(material.projectId)?.name}`
              : ""}
          </small>
          <ExternalLink size={15} />
        </a>
      ))}
    </div>
  );
}

function TaskCompactList({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return <p className="empty-copy">No unfinished tasks here.</p>;
  return (
    <div className="compact-tasks">
      {tasks.map((task) => (
        <div key={task.id}>
          <Circle size={14} />
          <span>{task.title}</span>
          <small>{priorityLabel[task.priority]}</small>
        </div>
      ))}
    </div>
  );
}

function BacklogList({
  tasks,
  onUpdate
}: {
  tasks: Task[];
  onUpdate: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<unknown>;
}) {
  if (!tasks.length) {
    return <p className="empty-copy">No standalone tasks are waiting here.</p>;
  }

  return (
    <div className="backlog-list">
      {tasks.map((task) => (
        <article key={task.id}>
          <Circle size={14} />
          <span>{task.title}</span>
          <input
            type="date"
            aria-label={`Schedule backlog task ${task.title}`}
            onChange={(event) => {
              if (event.target.value) {
                void onUpdate(task.id, {
                  date: event.target.value,
                  scheduleSource: "general-backlog"
                });
              }
            }}
          />
        </article>
      ))}
    </div>
  );
}

function TwoColumnView({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="two-column">
      {left}
      {right}
    </div>
  );
}

function headlineFor(active: string) {
  const labels: Record<string, string> = {
    today: "Make today legible",
    plan: "Plan with intention",
    journal: "Keep what matters",
    review: "Close the day with intention"
  };
  return labels[active] ?? labels.today;
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}
