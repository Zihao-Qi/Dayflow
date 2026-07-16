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
  GripVertical,
  LayoutDashboard,
  Library,
  LinkIcon,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Shrink,
  Sparkles,
  Trash2
} from "lucide-react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";

type Task = {
  id: string;
  title: string;
  date: string;
  status: TaskStatus;
  priority: Priority;
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  completedAt: string | null;
};

type Note = {
  id: string;
  content: string;
  tags: string[];
  taskId: string | null;
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
  stats: DayStat[];
};

const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "materials", label: "Materials", icon: Library },
  { id: "review", label: "Review", icon: Sparkles }
];

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
  const [data, setData] = useState<Bootstrap | null>(null);
  const [active, setActive] = useState("today");
  const [newTask, setNewTask] = useState("");
  const [newNote, setNewNote] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [activityTime, setActivityTime] = useState("");
  const [activityDuration, setActivityDuration] = useState("30");
  const [activityCategory, setActivityCategory] = useState(activityCategories[0]);
  const [activityTaskId, setActivityTaskId] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [activityError, setActivityError] = useState("");
  const [compactMode, setCompactMode] = useState(false);
  const [savingDiary, setSavingDiary] = useState(false);

  useEffect(() => {
    setActivityTime(formatTimeInput(new Date()));
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    setData(await response.json());
  }

  const todayTasks = useMemo(() => {
    if (!data) return [];
    const key = data.today.slice(0, 10);
    return data.tasks
      .filter((task) => task.date.slice(0, 10) === key)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  const futureTasks = useMemo(() => {
    if (!data) return [];
    const key = data.today.slice(0, 10);
    return data.tasks.filter((task) => task.date.slice(0, 10) > key);
  }, [data]);

  const todayActivities = useMemo(() => data?.activities ?? [], [data]);

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

  async function updateTask(id: string, patch: Partial<Task>) {
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task))
          }
        : current
    );
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    await refresh();
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
        tags: noteTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      })
    });
    setNewNote("");
    setNoteTags("");
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
        notes: materialNotes
      })
    });
    setMaterialTitle("");
    setMaterialUrl("");
    setMaterialNotes("");
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
    setActivityTime(formatTimeInput(new Date()));
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
                onClick={() => setActive(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <a className="agent-link" href="/api/agent-export" target="_blank">
          <Sparkles size={16} />
          Agent export
        </a>
      </aside>

      <section className={compactMode ? "workspace compact-mode" : "workspace"}>
        <header className="topbar">
          <div>
            <p className="date-line">{formatLongDate(data.today)}</p>
            <h1>{headlineFor(active)}</h1>
          </div>
          <div className="topbar-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button className="icon-button" onClick={() => setCompactMode(!compactMode)} title="Toggle compact mode">
              {compactMode ? <Expand size={16} /> : <Shrink size={16} />}
            </button>
            <div className="progress-tile">
              <span>{summary.rate}% complete</span>
              <div className="meter" aria-hidden="true">
                <i style={{ width: `${summary.rate}%` }} />
              </div>
            </div>
          </div>
        </header>

        {active === "today" && (
          <div className="dashboard-grid">
            <section className="panel task-panel">
              <PanelTitle icon={<Check size={18} />} title="Today" detail={`${summary.completed}/${summary.total} done`} />
              <div className="task-input-row">
                <input
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
                {todayTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onUpdate={updateTask}
                    onDelete={deleteTask}
                    onReorder={reorderTask}
                  />
                ))}
              </div>
            </section>

            <section className="panel summary-panel">
              <PanelTitle icon={<Clock3 size={18} />} title="Daily pulse" detail="Planned vs actual" />
              <div className="pulse-grid">
                <Metric label="Planned" value={`${summary.estimate}m`} />
                <Metric label="Spent" value={`${summary.actual}m`} />
                <Metric label="Energy" value={`${data.diary.energy}/5`} />
                <Metric label="Mood" value={`${data.diary.mood}/5`} />
              </div>
              <MiniTimeline blocks={data.timeBlocks} tasks={todayTasks} today={data.today} />
            </section>

            <section className="panel matrix-panel">
              <PanelTitle icon={<LayoutDashboard size={18} />} title="Urgency and importance" detail="Drag tasks or label them" />
              <UrgencyImportanceMatrix tasks={todayTasks} today={data.today} onUpdate={updateTask} />
            </section>

            <section className="panel activity-panel">
              <PanelTitle
                icon={<Clock3 size={18} />}
                title="What happened today?"
                detail={`${summary.actual}m recorded`}
              />
              <div className="activity-form">
                <div className="activity-form-grid">
                  <label>
                    Time
                    <input
                      type="time"
                      value={activityTime}
                      onChange={(event) => setActivityTime(event.target.value)}
                    />
                  </label>
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
                <label className="activity-task-field">
                  Linked task
                  <select
                    value={activityTaskId}
                    onChange={(event) => setActivityTaskId(event.target.value)}
                  >
                    <option value="">No linked task</option>
                    {todayTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={activityNote}
                  onChange={(event) => {
                    setActivityNote(event.target.value);
                    if (activityError) setActivityError("");
                  }}
                  placeholder="Record a small win or what moved forward."
                />
                {activityError && <p className="form-error">{activityError}</p>}
                <button className="secondary-button" onClick={() => void addActivity()}>
                  <Plus size={16} />
                  Add activity
                </button>
              </div>
              <ActivityList
                activities={todayActivities}
                tasks={todayTasks}
                onDelete={deleteActivity}
              />
            </section>

            <section className="panel diary-panel">
              <PanelTitle icon={<BookOpen size={18} />} title="Diary" detail={savingDiary ? "Saving" : "Today"} />
              <textarea
                value={data.diary.content}
                onChange={(event) => setDiaryValue("content", event.target.value)}
                placeholder="Write a few lines about the day."
              />
              <div className="range-row">
                <label>
                  Mood
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={data.diary.mood}
                    onChange={(event) => setDiaryValue("mood", Number(event.target.value))}
                  />
                </label>
                <label>
                  Energy
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={data.diary.energy}
                    onChange={(event) => setDiaryValue("energy", Number(event.target.value))}
                  />
                </label>
                <button className="icon-button" title="Save diary" onClick={() => void saveDiary()}>
                  <Save size={17} />
                </button>
              </div>
            </section>

            <section className="panel charts-panel">
              <PanelTitle icon={<LayoutDashboard size={18} />} title="Progress" detail="Last 7 days" />
              <Charts stats={data.stats} />
            </section>

            <section className="panel notes-panel">
              <PanelTitle icon={<NotebookPen size={18} />} title="Quick notes" detail={`${data.notes.length} notes`} />
              <div className="note-input">
                <textarea
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                  placeholder="Capture a thought, decision, or reminder."
                />
                <input
                  value={noteTags}
                  onChange={(event) => setNoteTags(event.target.value)}
                  placeholder="Tags, comma separated"
                />
                <button className="secondary-button" onClick={() => void addNote()}>
                  <Plus size={16} />
                  Save note
                </button>
              </div>
              <NoteList notes={data.notes} />
            </section>

            <section className="panel materials-panel">
              <PanelTitle icon={<Library size={18} />} title="Materials" detail="Links and references" />
              <div className="material-form">
                <input value={materialTitle} onChange={(event) => setMaterialTitle(event.target.value)} placeholder="Title" />
                <input value={materialUrl} onChange={(event) => setMaterialUrl(event.target.value)} placeholder="YouTube, article, PDF, or website URL" />
                <textarea value={materialNotes} onChange={(event) => setMaterialNotes(event.target.value)} placeholder="Optional notes" />
                <button className="secondary-button" onClick={() => void addMaterial()}>
                  <LinkIcon size={16} />
                  Save material
                </button>
              </div>
              <MaterialList materials={data.materials} />
            </section>
          </div>
        )}

        {active === "plan" && (
          <TwoColumnView
            left={
              <section className="panel">
                <PanelTitle icon={<CalendarDays size={18} />} title="Timeline" detail="Today and tomorrow" />
                <MiniTimeline blocks={data.timeBlocks} tasks={data.tasks} today={data.today} expanded />
              </section>
            }
            right={
              <section className="panel">
                <PanelTitle icon={<Circle size={18} />} title="Unfinished" detail="Carry forward" />
                <TaskCompactList tasks={[...todayTasks, ...futureTasks].filter((task) => task.status !== "DONE")} />
                <div className="plan-matrix">
                  <UrgencyImportanceMatrix
                    tasks={[...todayTasks, ...futureTasks].filter((task) => task.status !== "DONE")}
                    today={data.today}
                    onUpdate={updateTask}
                    compact
                  />
                </div>
              </section>
            }
          />
        )}

        {active === "notes" && (
          <TwoColumnView
            left={
              <section className="panel">
                <PanelTitle icon={<NotebookPen size={18} />} title="Notes" detail="Today's captures" />
                <NoteList notes={data.notes} />
              </section>
            }
            right={
              <section className="panel">
                <PanelTitle icon={<BookOpen size={18} />} title="Diary" detail="Reflection" />
                <textarea
                  className="large-textarea"
                  value={data.diary.content}
                  onChange={(event) => setDiaryValue("content", event.target.value)}
                />
                <button className="primary-button wide" onClick={() => void saveDiary()}>
                  <Save size={16} />
                  Save diary
                </button>
              </section>
            }
          />
        )}

        {active === "materials" && (
          <TwoColumnView
            left={
              <section className="panel">
                <PanelTitle icon={<Library size={18} />} title="Library" detail={`${data.materials.length} saved`} />
                <MaterialList materials={data.materials} />
              </section>
            }
            right={
              <section className="panel">
                <PanelTitle icon={<LinkIcon size={18} />} title="Add material" detail="Attach later to tasks or notes" />
                <div className="material-form roomy">
                  <input value={materialTitle} onChange={(event) => setMaterialTitle(event.target.value)} placeholder="Title" />
                  <input value={materialUrl} onChange={(event) => setMaterialUrl(event.target.value)} placeholder="URL" />
                  <textarea value={materialNotes} onChange={(event) => setMaterialNotes(event.target.value)} placeholder="Why this matters" />
                  <button className="primary-button" onClick={() => void addMaterial()}>
                    <Plus size={16} />
                    Add material
                  </button>
                </div>
              </section>
            }
          />
        )}

        {active === "review" && (
          <TwoColumnView
            left={
              <section className="panel">
                <PanelTitle icon={<Sparkles size={18} />} title="Today reviewed" detail={`${summary.completed} completed`} />
                <div className="review-stack">
                  <Metric label="Completion" value={`${summary.rate}%`} />
                  <Metric label="Remaining" value={`${Math.max(summary.total - summary.completed, 0)}`} />
                  <Metric label="Actual time" value={`${summary.actual}m`} />
                </div>
                <TaskCompactList tasks={todayTasks.filter((task) => task.status !== "DONE")} />
              </section>
            }
            right={
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
            }
          />
        )}
      </section>
    </main>
  );
}

function TaskRow({
  task,
  onUpdate,
  onDelete,
  onReorder
}: {
  task: Task;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (draggedId: string, targetId: string) => Promise<void>;
}) {
  const isDone = task.status === "DONE";
  const [isDraggable, setIsDraggable] = useState(false);

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
      <input
        className="task-title-input"
        value={task.title}
        onChange={(event) => void onUpdate(task.id, { title: event.target.value })}
      />
      <div className="row-actions">
        <button className="icon-button danger" title="Delete" onClick={() => void onDelete(task.id)}>
          <Trash2 size={16} />
        </button>
      </div>
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
        <select value={task.status} onChange={(event) => void onUpdate(task.id, { status: event.target.value as TaskStatus })}>
          {Object.entries(statusLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="mini-number"
          type="number"
          min="5"
          step="5"
          value={task.estimateMinutes}
          onChange={(event) => void onUpdate(task.id, { estimateMinutes: Number(event.target.value) })}
          title="Estimated minutes"
        />
      </div>
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
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
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
  onDelete
}: {
  activities: ActivityEntry[];
  tasks: Task[];
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
            {task && <small>Linked to {task.title}</small>}
          </article>
        );
      })}
    </div>
  );
}

function NoteList({ notes }: { notes: Note[] }) {
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
          </div>
        </article>
      ))}
    </div>
  );
}

function MaterialList({ materials }: { materials: Material[] }) {
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
          <small>{material.notes || material.url}</small>
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
    plan: "Plan the next blocks",
    notes: "Capture what matters",
    materials: "Keep useful references close",
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
