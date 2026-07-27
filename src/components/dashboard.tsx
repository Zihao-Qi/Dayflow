"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  ExternalLink,
  FileText,
  FolderKanban,
  GripVertical,
  Layers3,
  LayoutDashboard,
  Library,
  LinkIcon,
  Menu,
  NotebookPen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Timer,
  Trash2
} from "lucide-react";
import { ProjectsWorkspace } from "@/components/projects-workspace";
import { FocusDraft, FocusRail } from "@/components/focus-timer";
import { useFocusSession } from "@/components/focus-session-provider";
import { SaveStateChip, useSaveState } from "@/components/save-state";
import {
  LayoutMode,
  markDocumentResizing,
  useLayoutMode
} from "@/components/use-layout-mode";
import {
  focusElapsedSeconds,
  focusRemainingSeconds,
  formatFocusClock
} from "@/lib/focus-domain";
import {
  formatInvestedMinutes,
  ProjectSummary
} from "@/lib/project-domain";
import type { QueuePlacement } from "@/lib/focus-queue";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Screen =
  | "today"
  | "day-stream"
  | "day-timeline"
  | "projects"
  | "backlog"
  | "journal"
  | "review";
type DayView = "stream" | "timeline";
type JournalView = "daily" | "notes" | "references";
type BacklogArrange = "figure" | "quadrant" | "project" | "due";
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
  focusQueuePosition: number | null;
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

type ReviewSummary = {
  focusedMinutes: number;
  completedSessions: number;
  cancelledSessions: number;
  pendingRecordSessions: number;
  pendingRecordMinutes: number;
  longestMinutes: number;
  longestStartedAt: string | null;
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
  reviewSummary: ReviewSummary;
};

const activityCategories = ["Deep Work", "Learning", "Admin", "Health", "Rest"];

const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "day", label: "Log", icon: CalendarDays },
  { id: "projects", label: "Projects", icon: Layers3 },
  { id: "backlog", label: "Backlog", icon: Circle },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "review", label: "Review", icon: Sparkles }
] as const;

function describeTaskMove(title: string, position: number, total: number) {
  const edge =
    position === 0 ? " Now first." : position === total - 1 ? " Now last." : "";
  return `Moved "${title}" to position ${position + 1} of ${total}.${edge}`;
}

function diariesEqual(left: Diary, right: Diary) {
  return (
    left.id === right.id &&
    left.date === right.date &&
    left.content === right.content &&
    left.reflection === right.reflection &&
    left.mood === right.mood &&
    left.energy === right.energy
  );
}

export function Dashboard() {
  const focus = useFocusSession();
  const { mode: layoutMode, figureArrangement, wideFocusRail } = useLayoutMode();
  const compactLayout = layoutMode !== "desktop";
  const phoneLayout = layoutMode === "phone";
  const [data, setData] = useState<Bootstrap | null>(null);
  const [screen, setScreen] = useState<Screen>("today");
  const [railExpanded, setRailExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [journalView, setJournalView] = useState<JournalView>("daily");
  const [backlogArrange, setBacklogArrange] =
    useState<BacklogArrange>("quadrant");
  const [backlogScopeProjectId, setBacklogScopeProjectId] = useState<string | null>(
    null
  );
  const [newTask, setNewTask] = useState("");
  const [newNote, setNewNote] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [focusDraft, setFocusDraft] = useState<FocusDraft | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityTime, setActivityTime] = useState("");
  const [activityDuration, setActivityDuration] = useState("30");
  const [activityCategory, setActivityCategory] = useState(activityCategories[0]);
  const [activityTaskId, setActivityTaskId] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [activityError, setActivityError] = useState("");
  const [dismissedUnfinished, setDismissedUnfinished] = useState<string[]>([]);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [firstRunSeen, setFirstRunSeen] = useState<boolean | null>(null);
  const [appAnnouncement, setAppAnnouncement] = useState("");
  const [appError, setAppError] = useState("");
  const taskSaveWasInError = useRef(false);
  const diarySaveWasInError = useRef(false);

  useEffect(() => {
    setActivityTime(formatTimeInput(new Date()));
    setFirstRunSeen(window.localStorage.getItem("dayflow-first-run-seen") === "1");
    void refresh();
  }, []);

  useEffect(() => {
    if (focus.activityRevision > 0) void refresh();
  }, [focus.activityRevision]);

  useEffect(() => {
    if (!figureArrangement) {
      setBacklogArrange((current) =>
        current === "figure" ? "quadrant" : current
      );
    }
  }, [figureArrangement]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!focus.active) {
          setFocusDraft({ revision: Date.now(), plannedMinutes: 25 });
          if (screen !== "today") setRailExpanded(true);
        }
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [focus.active, screen]);

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

  const openTodayTasks = todayTasks.filter((task) => task.status !== "DONE");
  const doneTodayTasks = todayTasks.filter((task) => task.status === "DONE");
  const backlogTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((task) => !task.date && task.status !== "DONE")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );
  const queuedTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter(
          (task) =>
            task.status !== "DONE" && task.focusQueuePosition !== null
        )
        .sort(
          (a, b) =>
            (a.focusQueuePosition ?? Number.MAX_SAFE_INTEGER) -
            (b.focusQueuePosition ?? Number.MAX_SAFE_INTEGER)
        ),
    [data]
  );
  const projectById = useMemo(
    () => new Map((data?.projects ?? []).map((project) => [project.id, project])),
    [data]
  );
  const visibleUnfinished = (data?.unfinishedTasks ?? []).filter(
    (task) => !dismissedUnfinished.includes(task.id)
  );
  const plannedMinutes = todayTasks.reduce(
    (sum, task) => sum + task.estimateMinutes,
    0
  );
  const activityMinutes = (data?.activities ?? []).reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );

  function navigate(next: Screen) {
    setScreen(next);
    setRailExpanded(false);
    setPaletteOpen(false);
    setMobileMoreOpen(false);
    if (next !== "projects") setSelectedProjectId(null);
  }

  function openFocus(target: FocusTarget) {
    if (compactLayout && target.plannedMinutes) {
      void focus.start({
        kind: "FOCUS",
        plannedMinutes: target.plannedMinutes,
        label: target.label,
        taskId: target.taskId ?? null,
        projectId: target.taskId ? null : target.projectId ?? null
      });
      return;
    }
    setFocusDraft({ ...target, revision: Date.now() });
    setPaletteOpen(false);
    if (screen !== "today") setRailExpanded(true);
  }

  function openProject(id: string) {
    setSelectedProjectId(id);
    setScreen("projects");
    setRailExpanded(false);
  }

  function openProjectBacklog(id: string) {
    setBacklogArrange("project");
    setBacklogScopeProjectId(id);
    navigate("backlog");
  }

  async function addTask(date: string | null = data?.today.slice(0, 10) ?? null) {
    if (!newTask.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask.trim(), date, estimateMinutes: 30 })
    });
    setNewTask("");
    await refresh();
  }

  async function beginFirstRun(title: string, startFocus: boolean) {
    const trimmed = title.trim();
    if (!trimmed || !data) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: trimmed,
        date: data.today.slice(0, 10),
        estimateMinutes: 25
      })
    });
    if (!response.ok) return;
    const task = (await response.json()) as Task;
    window.localStorage.setItem("dayflow-first-run-seen", "1");
    setFirstRunSeen(true);
    await refresh();
    if (startFocus) {
      openFocus({
        taskId: task.id,
        label: task.title,
        plannedMinutes: 25
      });
    }
  }

  async function saveTaskAttempt(
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) {
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
      if (!response.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }

  function reportTaskSaveFailure() {
    taskSaveWasInError.current = true;
    setAppError("Couldn’t save that change. Your text is still here — retry.");
    setAppAnnouncement("Changes were not saved.");
  }

  function reportTaskSaveRecovery() {
    if (!taskSaveWasInError.current) return;
    taskSaveWasInError.current = false;
    setAppError("");
    setAppAnnouncement("Saved.");
  }

  async function updateTask(
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await saveTaskAttempt(id, patch)) {
        setAppError("");
        reportTaskSaveRecovery();
        return true;
      }
      if (attempt < 2) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, attempt === 0 ? 1000 : 4000)
        );
      }
    }
    reportTaskSaveFailure();
    return false;
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function reorderTask(
    draggedId: string,
    targetId: string,
    announce = true
  ) {
    if (draggedId === targetId) return true;
    const oldIndex = openTodayTasks.findIndex((task) => task.id === draggedId);
    const newIndex = openTodayTasks.findIndex((task) => task.id === targetId);
    if (oldIndex < 0 || newIndex < 0) return false;
    const reordered = [...openTodayTasks];
    const [item] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, item);
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => {
              const index = reordered.findIndex((candidate) => candidate.id === task.id);
              return index < 0 ? task : { ...task, sortOrder: index };
            })
          }
        : current
    );
    try {
      const response = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((task) => task.id) })
      });
      if (!response.ok) throw new Error("Order could not be saved.");
      setAppError("");
      if (announce) {
        setAppAnnouncement(
          describeTaskMove(item.title, newIndex, reordered.length)
        );
      }
      await refresh();
      return true;
    } catch {
      setAppError("Couldn’t save the new order. Retry the move.");
      setAppAnnouncement("The new task order was not saved.");
      await refresh();
      return false;
    }
  }

  async function queueTask(task: Task, placement: QueuePlacement) {
    try {
      const response = await fetch("/api/focus-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, placement })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The queue could not be saved.");
      setAppError("");
      setAppAnnouncement(
        placement === "next"
          ? `${task.title}, queued next.`
          : `${task.title}, added to the queue.`
      );
      await refresh();
      return true;
    } catch {
      setAppError("Couldn’t save the focus queue. Try that action again.");
      setAppAnnouncement("The focus queue was not saved.");
      return false;
    }
  }

  async function removeQueuedTask(task: Task) {
    try {
      const response = await fetch("/api/focus-queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The queue could not be saved.");
      setAppError("");
      setAppAnnouncement(`${task.title}, removed from the queue.`);
      await refresh();
      return true;
    } catch {
      setAppError("Couldn’t remove that task from the focus queue.");
      setAppAnnouncement("The focus queue was not saved.");
      return false;
    }
  }

  async function reorderQueue(ids: string[], announcement: string) {
    const previous = queuedTasks;
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => {
              const index = ids.indexOf(task.id);
              return index < 0
                ? task
                : { ...task, focusQueuePosition: index };
            })
          }
        : current
    );
    try {
      const response = await fetch("/api/focus-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          expectedIds: previous.map((task) => task.id)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The queue could not be saved.");
      setAppError("");
      setAppAnnouncement(announcement);
      await refresh();
      return true;
    } catch {
      setData((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((task) => {
                const prior = previous.find((item) => item.id === task.id);
                return prior
                  ? { ...task, focusQueuePosition: prior.focusQueuePosition }
                  : task;
              })
            }
          : current
      );
      setAppError("Couldn’t save the new queue order. Retry the move.");
      setAppAnnouncement("The new queue order was not saved.");
      await refresh();
      return false;
    }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newNote.trim(),
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

  async function addMaterial() {
    if (!materialUrl.trim()) return;
    await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: materialTitle.trim(),
        url: materialUrl.trim(),
        notes: materialNotes.trim()
      })
    });
    setMaterialTitle("");
    setMaterialUrl("");
    setMaterialNotes("");
    await refresh();
  }

  async function saveDiary(diary: Diary) {
    try {
      const response = await fetch("/api/diary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diary)
      });
      if (!response.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }

  function reportDiarySaveFailure() {
    diarySaveWasInError.current = true;
    setAppAnnouncement("Journal was not saved.");
    setAppError("Couldn’t save the journal. Your writing is still here — retry.");
  }

  function reportDiarySaveRecovery() {
    if (!diarySaveWasInError.current) return;
    diarySaveWasInError.current = false;
    setAppAnnouncement("Saved.");
    setAppError("");
  }

  function setDiaryValue<K extends keyof Diary>(key: K, value: Diary[K]) {
    setData((current) =>
      current
        ? { ...current, diary: { ...current.diary, [key]: value } }
        : current
    );
  }

  async function addActivity() {
    const minutes = Number(activityDuration);
    if (!activityNote.trim()) {
      setActivityError("Add a short note about what happened.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setActivityError("Duration must be between 1 and 1440 minutes.");
      return;
    }
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: data?.today,
        startTime: activityTime,
        durationMinutes: minutes,
        category: activityCategory,
        taskId: activityTaskId || null,
        note: activityNote.trim()
      })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setActivityError(result?.error ?? "Activity could not be saved.");
      return;
    }
    setActivityNote("");
    setActivityTaskId("");
    setActivityError("");
    setActivityOpen(false);
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

  const isToday = screen === "today";
  const liveFocus = focus.active ?? focus.pendingCompletion;
  const showFullRail =
    (phoneLayout && railExpanded && Boolean(liveFocus)) ||
    (!compactLayout &&
      (isToday ||
        (wideFocusRail && Boolean(liveFocus)) ||
        (railExpanded && Boolean(liveFocus || focusDraft))));
  const showStrip =
    Boolean(liveFocus) &&
    !showFullRail &&
    (compactLayout || !isToday);
  const focusedMinutes = focus.snapshot?.today.focusedMinutes ?? 0;
  const completedSessions = focus.snapshot?.today.completedSessions ?? 0;
  const firstRun =
    firstRunSeen === false &&
    data.tasks.length === 0 &&
    data.projects.length === 0 &&
    data.activities.length === 0;

  return (
    <main className="app-shell focus-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <strong>Dayflow</strong>
        </div>
        <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Plus size={15} />
          <span>Search or add</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="nav-list" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            const itemScreen = item.id === "day" ? "day-stream" : item.id;
            const active =
              item.id === "day" ? screen.startsWith("day-") : screen === itemScreen;
            const count =
              item.id === "today"
                ? openTodayTasks.length
                : item.id === "projects"
                  ? data.projects.filter((project) => project.status === "ACTIVE").length
                  : item.id === "backlog"
                    ? backlogTasks.length
                    : null;
            return (
              <button
                key={item.id}
                className={active ? "nav-item active" : "nav-item"}
                data-nav-id={item.id}
                onClick={() => navigate(itemScreen as Screen)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {count !== null && <small>{count}</small>}
              </button>
            );
          })}
          <button
            className={mobileMoreOpen ? "nav-item mobile-more active" : "nav-item mobile-more"}
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <Menu size={16} />
            <span>More</span>
          </button>
        </nav>
        {!liveFocus && !isToday && (
          <button
            className="sidebar-focus-button focus-button"
            onClick={() => {
              setFocusDraft({ revision: Date.now(), plannedMinutes: 25 });
              setRailExpanded(true);
            }}
          >
            <Play size={14} />
            Start focus
            <kbd>⌘⇧F</kbd>
          </button>
        )}
        <footer className="sidebar-focus-summary">
          <span className="eyebrow">Today&apos;s focus</span>
          <strong>{formatMinutes(focusedMinutes)}</strong>
          <div className="focus-pips" aria-label={`${completedSessions} of 4 planned blocks`}>
            {[0, 1, 2, 3].map((index) => (
              <i key={index} className={index < completedSessions ? "filled" : ""} />
            ))}
          </div>
          <small>{completedSessions} of 4 planned blocks</small>
        </footer>
      </aside>

      <section className="workspace">
        <button
          className="mobile-capture-button"
          aria-label="Search or add"
          onClick={() => setPaletteOpen(true)}
        >
          <Plus size={19} />
          <span>Capture</span>
        </button>
        {screen === "today" && firstRun && (
          <FirstRunPage today={data.today} onBegin={beginFirstRun} />
        )}
        {screen === "today" && !firstRun && (
          <TodayPage
            layoutMode={layoutMode}
            today={data.today}
            tasks={todayTasks}
            backlogTasks={backlogTasks}
            unfinishedTasks={visibleUnfinished}
            projects={data.projects}
            projectById={projectById}
            plannedMinutes={plannedMinutes}
            focusedMinutes={focusedMinutes}
            activeFocus={focus.active}
            focusNow={focus.now}
            focusBusy={focus.busy}
            onFocusTransition={focus.transition}
            onAddTask={addTask}
            newTask={newTask}
            onNewTaskChange={setNewTask}
            onUpdateTask={updateTask}
            onSaveTaskField={saveTaskAttempt}
            onTaskSaveError={reportTaskSaveFailure}
            onTaskSaveRecovered={reportTaskSaveRecovery}
            onDeleteTask={deleteTask}
            onReorderTask={reorderTask}
            onAnnounce={setAppAnnouncement}
            onStartFocus={openFocus}
            onQueueTask={queueTask}
            onOpenProject={openProject}
            onOpenBacklog={() => navigate("backlog")}
            onLeaveUnfinished={(id) =>
              setDismissedUnfinished((current) => [...current, id])
            }
            activities={data.activities}
          />
        )}

        {screen.startsWith("day-") && (
          <DayPage
            view={screen.replace("day-", "") as DayView}
            today={data.today}
            tasks={openTodayTasks}
            activities={data.activities}
            timeBlocks={data.timeBlocks}
            projects={projectById}
            plannedMinutes={plannedMinutes}
            recordedMinutes={activityMinutes}
            noteCount={data.notes.length}
            activeFocus={focus.active}
            focusNow={focus.now}
            focusBusy={focus.busy}
            onViewChange={(view) => navigate(`day-${view}`)}
            onStartFocus={openFocus}
            onQueueTask={queueTask}
            onFocusTransition={focus.transition}
            onOpenPalette={() => setPaletteOpen(true)}
          />
        )}

        {screen === "projects" && (
          <ProjectsWorkspace
            projects={data.projects}
            selectedProjectId={selectedProjectId}
            createOpen={projectCreateOpen}
            today={data.today}
            onSelectedProjectChange={setSelectedProjectId}
            onCreateOpenChange={setProjectCreateOpen}
            onDataChanged={refresh}
            onStartFocus={openFocus}
            onOpenBacklog={openProjectBacklog}
          />
        )}

        {screen === "backlog" && (
          <BacklogPage
            figureArrangement={figureArrangement}
            tasks={backlogTasks}
            projects={projectById}
            today={data.today}
            arrangement={backlogArrange}
            onArrangementChange={setBacklogArrange}
            scopeProjectId={backlogScopeProjectId}
            onClearScope={() => setBacklogScopeProjectId(null)}
            onOpenProject={openProject}
            activeTaskId={focus.active?.taskId ?? null}
            onStartFocus={openFocus}
            onUpdateTask={updateTask}
            onOpenPalette={() => setPaletteOpen(true)}
          />
        )}

        {screen === "journal" && (
          <JournalPage
            today={data.today}
            view={journalView}
            onViewChange={setJournalView}
            diary={data.diary}
            notes={data.notes}
            materials={data.materials}
            projects={projectById}
            onDiaryChange={setDiaryValue}
            onSaveDiary={saveDiary}
            onSaveError={reportDiarySaveFailure}
            onSaveRecovered={reportDiarySaveRecovery}
            newNote={newNote}
            noteTags={noteTags}
            onNewNoteChange={setNewNote}
            onNoteTagsChange={setNoteTags}
            onAddNote={addNote}
            materialTitle={materialTitle}
            materialUrl={materialUrl}
            materialNotes={materialNotes}
            onMaterialTitleChange={setMaterialTitle}
            onMaterialUrlChange={setMaterialUrl}
            onMaterialNotesChange={setMaterialNotes}
            onAddMaterial={addMaterial}
          />
        )}

        {screen === "review" && (
          <ReviewPage
            today={data.today}
            stats={data.stats}
            projects={data.projects}
            diary={data.diary}
            summary={data.reviewSummary}
            onDiaryChange={setDiaryValue}
            onSaveDiary={saveDiary}
            onSaveError={reportDiarySaveFailure}
            onSaveRecovered={reportDiarySaveRecovery}
            onOpenProject={openProject}
          />
        )}
      </section>

      {mobileMoreOpen && (
        <div className="mobile-more-menu" role="menu" aria-label="More destinations">
          <button role="menuitem" onClick={() => navigate("backlog")}>
            <FolderKanban size={17} />
            Backlog
            <small>{backlogTasks.length}</small>
          </button>
          <button role="menuitem" onClick={() => navigate("journal")}>
            <NotebookPen size={17} />
            Journal
          </button>
        </div>
      )}

      {phoneLayout && railExpanded && liveFocus && (
        <button
          className="focus-sheet-backdrop"
          aria-label="Close focus sheet"
          onClick={() => setRailExpanded(false)}
        />
      )}
      {showFullRail && (
        <FocusRail
          tasks={data.tasks.filter((task) => task.status !== "DONE")}
          projects={data.projects}
          today={data.today}
          draft={focusDraft}
          activities={data.activities}
          queuedTasks={queuedTasks}
          mode="full"
          collapsible={phoneLayout || (!isToday && !wideFocusRail)}
          onCollapse={() => setRailExpanded(false)}
          onOpenPalette={() => setPaletteOpen(true)}
          onQueueTask={(taskId, placement) => {
            const task = data.tasks.find((item) => item.id === taskId);
            return task ? queueTask(task, placement) : Promise.resolve(false);
          }}
          onRemoveQueuedTask={(taskId) => {
            const task = data.tasks.find((item) => item.id === taskId);
            return task ? removeQueuedTask(task) : Promise.resolve(false);
          }}
          onReorderQueue={reorderQueue}
          onQueueChanged={refresh}
          onAnnounce={setAppAnnouncement}
        />
      )}
      {showStrip && (
        <FocusRail
          tasks={data.tasks.filter((task) => task.status !== "DONE")}
          projects={data.projects}
          today={data.today}
          draft={focusDraft}
          activities={data.activities}
          queuedTasks={queuedTasks}
          mode="strip"
          onExpand={
            phoneLayout || !compactLayout ? () => setRailExpanded(true) : undefined
          }
        />
      )}

      {paletteOpen && (
        <CommandPalette
          projects={data.projects}
          onClose={() => setPaletteOpen(false)}
          onStartFocus={() => {
            openFocus({ plannedMinutes: 50 });
            if (screen !== "today") setRailExpanded(true);
          }}
          onNewTask={() => {
            navigate("today");
            window.setTimeout(() => document.getElementById("new-task")?.focus(), 0);
          }}
          onLogActivity={() => {
            setPaletteOpen(false);
            setActivityOpen(true);
          }}
          onWriteNote={() => {
            navigate("journal");
            setJournalView("notes");
            window.setTimeout(() => document.getElementById("new-note")?.focus(), 0);
          }}
          onSaveReference={() => {
            navigate("journal");
            setJournalView("references");
            window.setTimeout(() => document.getElementById("material-url")?.focus(), 0);
          }}
          onOpenProject={openProject}
        />
      )}

      {activityOpen && (
        <ActivityDialog
          tasks={todayTasks}
          time={activityTime}
          duration={activityDuration}
          category={activityCategory}
          taskId={activityTaskId}
          note={activityNote}
          error={activityError}
          onTimeChange={setActivityTime}
          onDurationChange={setActivityDuration}
          onCategoryChange={setActivityCategory}
          onTaskChange={setActivityTaskId}
          onNoteChange={(value) => {
            setActivityNote(value);
            setActivityError("");
          }}
          onClose={() => setActivityOpen(false)}
          onSave={addActivity}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {appAnnouncement}
      </div>
      {appError && (
        <div className="app-error-toast" role="alert">
          <span>{appError}</span>
          <button className="text-button" onClick={() => setAppError("")}>
            Dismiss
          </button>
        </div>
      )}
    </main>
  );
}

function TodayPage({
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
}: {
  layoutMode: LayoutMode;
  today: string;
  tasks: Task[];
  backlogTasks: Task[];
  unfinishedTasks: Task[];
  projects: ProjectSummary[];
  projectById: Map<string, ProjectSummary>;
  plannedMinutes: number;
  focusedMinutes: number;
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
  focusBusy: boolean;
  onFocusTransition: ReturnType<typeof useFocusSession>["transition"];
  onAddTask: () => Promise<void>;
  newTask: string;
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
  activities: ActivityEntry[];
}) {
  const phoneLayout = layoutMode === "phone";
  const open = tasks.filter((task) => task.status !== "DONE");
  const done = tasks.filter((task) => task.status === "DONE");
  const firstCarry = unfinishedTasks[0];
  const [reorderMode, setReorderMode] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const reorderButtonRef = useRef<HTMLButtonElement | null>(null);
  const instructionDoneRef = useRef<HTMLButtonElement | null>(null);

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
        title={`${numberWord(open.length)} ${open.length === 1 ? "block" : "blocks"} left`}
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
                  date: today.slice(0, 10),
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
              if (event.key === "Enter") void onAddTask();
            }}
            placeholder="Add a task for today"
          />
          <button className="primary-button" onClick={() => void onAddTask()}>
            <Plus size={15} />
            Add
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
              <span>Add one deliberate block when you are ready.</span>
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
                  date: today.slice(0, 10),
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

function TaskRow({
  task,
  suggested = false,
  project,
  projects,
  reorderMode = false,
  position = 0,
  total = 0,
  onMove,
  onUpdate,
  onSaveField,
  onSaveError,
  onSaveRecovered,
  onDelete,
  onReorder,
  onOpenProject,
  onStartFocus,
  liveSession,
  activeTaskId,
  onQueueTask
}: {
  task: Task;
  suggested?: boolean;
  project?: ProjectSummary;
  projects: ProjectSummary[];
  reorderMode?: boolean;
  position?: number;
  total?: number;
  onMove?: (direction: -1 | 1) => void;
  onUpdate: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<boolean>;
  onSaveField: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  onDelete: (id: string) => Promise<void>;
  onReorder: (source: string, target: string) => Promise<boolean>;
  onOpenProject: (id: string) => void;
  onStartFocus: (target: FocusTarget) => void;
  liveSession: boolean;
  activeTaskId: string | null;
  onQueueTask: (task: Task, placement: QueuePlacement) => Promise<boolean>;
}) {
  const done = task.status === "DONE";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draggable, setDraggable] = useState(false);
  const saveCallbacks = {
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  };
  const titleSave = useSaveState({
    value: task.title,
    save: (value: string) => onSaveField(task.id, { title: value }),
    normalize: (value: string) => value.trim(),
    isValid: (value: string) => Boolean(value),
    ...saveCallbacks
  });
  const deadlineSave = useSaveState({
    value: task.deadline?.slice(0, 10) ?? "",
    save: (value: string) =>
      onSaveField(task.id, { deadline: value || null }),
    ...saveCallbacks
  });
  const estimateSave = useSaveState({
    value: String(task.estimateMinutes),
    save: (value: string) =>
      onSaveField(task.id, { estimateMinutes: Number(value) }),
    normalize: (value: string) => value.trim(),
    isValid: (value: string) => {
      const minutes = Number(value);
      return Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440;
    },
    ...saveCallbacks
  });
  const projectSave = useSaveState({
    value: task.projectId ?? "",
    save: (value: string) =>
      onSaveField(task.id, {
        projectId: value || null,
        phaseId: null
      }),
    ...saveCallbacks
  });
  const statusSave = useSaveState<TaskStatus>({
    value: task.status,
    save: (value) => onSaveField(task.id, { status: value }),
    ...saveCallbacks
  });

  return (
    <article
      className={done ? "task-row done" : "task-row"}
      aria-label={`Task: ${task.title}`}
      draggable={reorderMode && draggable}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData("text/plain");
        if (source) void onReorder(source, task.id);
      }}
    >
      <button
        className="check-button"
        aria-label={done ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
        onClick={() =>
          void onUpdate(task.id, { status: done ? "TODO" : "DONE" })
        }
      >
        {done ? <Check size={15} /> : <Circle size={15} />}
      </button>
      <div
        className={`drag-handle ${reorderMode ? "visible" : ""}`}
        aria-hidden={!reorderMode}
        onMouseEnter={() => setDraggable(true)}
        onMouseLeave={() => setDraggable(false)}
      >
        <GripVertical size={14} />
      </div>
      <div className="task-main">
        <div className="task-title-editor">
          <input
            className="task-title-input"
            aria-label={`Task title: ${task.title}`}
            value={titleSave.draft}
            onChange={(event) => titleSave.setDraft(event.target.value)}
            onBlur={titleSave.inputProps.onBlur}
            onKeyDown={(event) => {
              titleSave.inputProps.onKeyDown(event);
              if (
                event.key === "Enter" &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.currentTarget.blur();
              }
            }}
          />
          <SaveStateChip
            state={titleSave.state}
            onRetry={() => void titleSave.flush(true)}
            className="task-save-state"
          />
        </div>
        <p>
          {task.estimateMinutes}m
          {task.deadline ? ` · due ${formatShortDate(task.deadline)}` : ""}
          {project ? ` · ${project.name}` : " · standalone"}
        </p>
      </div>
      <span className="duration-pill">{task.estimateMinutes}m</span>
      {reorderMode && !done && (
        <div className="task-reorder-controls">
          <span>{position + 1} of {total}</span>
          <button
            type="button"
            disabled={position === 0}
            aria-label={`Move ${task.title} up`}
            data-reorder-task={task.id}
            data-reorder-direction="up"
            onClick={() => onMove?.(-1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            disabled={position === total - 1}
            aria-label={`Move ${task.title} down`}
            data-reorder-task={task.id}
            data-reorder-direction="down"
            onClick={() => onMove?.(1)}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      )}
      {!done && !reorderMode && liveSession && activeTaskId !== task.id && (
        <button
          className="focus-row-button queue-row-button"
          disabled={task.focusQueuePosition !== null}
          onClick={() =>
            void onQueueTask(task, suggested ? "next" : "end")
          }
        >
          {task.focusQueuePosition !== null
            ? "Queued"
            : suggested
              ? "Queue next"
              : "Queue"}
        </button>
      )}
      {!done && !reorderMode && !liveSession && (
        <button
          className={suggested ? "focus-row-button suggested focus-button" : "focus-row-button"}
          onClick={() =>
            onStartFocus({
              taskId: task.id,
              projectId: task.projectId ?? undefined,
              label: task.title,
              plannedMinutes: task.estimateMinutes
            })
          }
        >
          <Play size={13} />
          Focus {task.estimateMinutes}m
        </button>
      )}
      {done && <span className="session-count">1 session</span>}
      {!reorderMode && (
        <button
          className="task-details-toggle"
          aria-label={`${detailsOpen ? "Hide" : "Show"} task details: ${task.title}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
      {detailsOpen && (
        <div className="task-details">
          <div className="task-controls">
            <label>
              Urgency · {task.urgentScore} of 5
              <ScoreDots
                value={task.urgentScore}
                tone="urgent"
                onChange={(value) => void onUpdate(task.id, { urgentScore: value })}
              />
            </label>
            <label>
              Importance · {task.importanceScore} of 5
              <ScoreDots
                value={task.importanceScore}
                tone="important"
                onChange={(value) => void onUpdate(task.id, { importanceScore: value })}
              />
            </label>
            <label>
              <span className="task-field-label">
                Deadline
                <SaveStateChip
                  state={deadlineSave.state}
                  onRetry={() => void deadlineSave.flush(true)}
                />
              </span>
              <input
                type="date"
                aria-label="Deadline"
                value={deadlineSave.draft}
                onChange={(event) => deadlineSave.setDraft(event.target.value)}
                {...deadlineSave.inputProps}
              />
            </label>
            <label>
              <span className="task-field-label">
                Estimate
                <SaveStateChip
                  state={estimateSave.state}
                  onRetry={() => void estimateSave.flush(true)}
                />
              </span>
              <span className="task-estimate-input">
                <input
                  type="number"
                  aria-label="Estimate in minutes"
                  min="1"
                  max="1440"
                  value={estimateSave.draft}
                  onChange={(event) => estimateSave.setDraft(event.target.value)}
                  {...estimateSave.inputProps}
                />
                <small>min</small>
              </span>
            </label>
            <label>
              <span className="task-field-label">
                Project
                <SaveStateChip
                  state={projectSave.state}
                  onRetry={() => void projectSave.flush(true)}
                />
              </span>
              <select
                aria-label="Project name"
                value={projectSave.draft}
                onChange={(event) => projectSave.setDraft(event.target.value)}
                {...projectSave.inputProps}
              >
                <option value="">No project</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="task-field-label">
                Status
                <SaveStateChip
                  state={statusSave.state}
                  onRetry={() => void statusSave.flush(true)}
                />
              </span>
              <select
                aria-label="Task status"
                value={statusSave.draft}
                onChange={(event) =>
                  statusSave.setDraft(event.target.value as TaskStatus)
                }
                {...statusSave.inputProps}
              >
                <option value="TODO">To do</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="DONE">Done</option>
              </select>
            </label>
          </div>
          <div className="task-detail-actions">
            <span className="task-lands-label">Lands in</span>
            <span className={`task-quadrant-readout ${taskQuadrant(task, new Date().toISOString()).id}`}>
              {taskQuadrant(task, new Date().toISOString()).label}
            </span>
            <i />
            <button
              className="text-button danger"
              aria-label={`Delete task: ${task.title}`}
              onClick={() => void onDelete(task.id)}
            >
              <Trash2 size={13} />
              Delete task
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function FirstRunPage({
  today,
  onBegin
}: {
  today: string;
  onBegin: (title: string, startFocus: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="first-run-page page-stack">
      <PageHeader eyebrow={formatLongDate(today)} title="Nothing here yet" />
      <p className="first-run-intro">
        Dayflow keeps one honest record of where your attention went. There is nothing
        to import and nothing to configure — the first block of focus is the whole setup.
      </p>
      <section className="first-run-start">
        <span className="eyebrow focus-eyebrow">Start here</span>
        <label>
          What are you working on right now?
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name one thing"
          />
        </label>
        <div>
          <button
            className="primary-button"
            disabled={!title.trim()}
            onClick={() => void onBegin(title, true)}
          >
            <Play size={15} />
            Focus on it for 25m
          </button>
          <button
            className="secondary-button"
            disabled={!title.trim()}
            onClick={() => void onBegin(title, false)}
          >
            Just add it to today
          </button>
        </div>
      </section>
      <section className="first-run-ready">
        <span className="eyebrow">When you are ready</span>
        <button>
          <Layers3 size={17} />
          <span>
            <strong>Group work under a project</strong>
            <small>Only worth it when something takes more than a few days.</small>
          </span>
        </button>
        <button>
          <NotebookPen size={17} />
          <span>
            <strong>
              Capture anything<span className="desktop-shortcut"> with ⌘K</span>
            </strong>
            <small>Tasks, notes, links and time you already spent.</small>
          </span>
        </button>
      </section>
      <p className="first-run-footnote">
        Review and Log stay empty until there is something to show. That is
        intentional — they fill themselves in.
      </p>
    </div>
  );
}

function DayPage({
  view,
  today,
  tasks,
  activities,
  timeBlocks,
  projects,
  plannedMinutes,
  recordedMinutes,
  noteCount,
  activeFocus,
  focusNow,
  focusBusy,
  onViewChange,
  onStartFocus,
  onQueueTask,
  onFocusTransition,
  onOpenPalette
}: {
  view: DayView;
  today: string;
  tasks: Task[];
  activities: ActivityEntry[];
  timeBlocks: TimeBlock[];
  projects: Map<string, ProjectSummary>;
  plannedMinutes: number;
  recordedMinutes: number;
  noteCount: number;
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
  focusBusy: boolean;
  onViewChange: (view: DayView) => void;
  onStartFocus: (target: FocusTarget) => void;
  onQueueTask: (task: Task, placement: QueuePlacement) => Promise<boolean>;
  onFocusTransition: ReturnType<typeof useFocusSession>["transition"];
  onOpenPalette: () => void;
}) {
  return (
    <div className="day-page log-page page-stack">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title="Log"
        actions={
          <SegmentedControl
            value={view}
            options={[
              ["stream", "Stream"],
              ["timeline", "Timeline"]
            ]}
            onChange={onViewChange}
          />
        }
      />
      <div className="log-totals" aria-label="Today’s log totals">
        <span>{formatMinutes(plannedMinutes)} planned</span>
        <strong>{formatMinutes(recordedMinutes)} recorded</strong>
        <span>
          {activities.length} {activities.length === 1 ? "session" : "sessions"} ·{" "}
          {noteCount} {noteCount === 1 ? "note" : "notes"}
        </span>
        <small>so far today</small>
      </div>
      {view === "stream" && (
        <DayStream
          tasks={tasks}
          activities={activities}
          projects={projects}
          activeFocus={activeFocus}
          focusNow={focusNow}
          focusBusy={focusBusy}
          onStartFocus={onStartFocus}
          onQueueTask={onQueueTask}
          onFocusTransition={onFocusTransition}
          onOpenPalette={onOpenPalette}
        />
      )}
      {view === "timeline" && (
        <DayTimeline
          today={today}
          blocks={timeBlocks}
          activities={activities}
          activeFocus={activeFocus}
          focusNow={focusNow}
        />
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
  onOpenPalette
}: {
  tasks: Task[];
  activities: ActivityEntry[];
  projects: Map<string, ProjectSummary>;
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
  focusBusy: boolean;
  onStartFocus: (target: FocusTarget) => void;
  onQueueTask: (task: Task, placement: QueuePlacement) => Promise<boolean>;
  onFocusTransition: ReturnType<typeof useFocusSession>["transition"];
  onOpenPalette: () => void;
}) {
  let cursor = new Date();
  const idleNext = !activeFocus ? tasks[0] ?? null : null;
  const plannedTasks = activeFocus
    ? tasks.filter((task) => task.id !== activeFocus.taskId)
    : tasks.slice(1);
  return (
    <section className="day-view">
      <p className="view-explainer">
        Above the marker is what happened. Below it is what is still planned — that
        part you can still change.
      </p>
      <div className="day-stream">
        {[...activities].reverse().map((activity) => (
          <article className="stream-row complete" key={activity.id}>
            <time>{formatActivityTime(activity.startedAt)}</time>
            <div>
              <i />
              <strong>
                {activity.durationMinutes}m · {activity.category}
              </strong>
              <p>{activity.note}</p>
              {activity.projectId && projects.get(activity.projectId) && (
                <span>{projects.get(activity.projectId)?.name}</span>
              )}
            </div>
          </article>
        ))}
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
                    void onFocusTransition(
                      activeFocus.status === "PAUSED" ? "resume" : "pause"
                    )
                  }
                >
                  {activeFocus.status === "PAUSED" ? "Resume" : "Pause"}
                </button>
                <button
                  className="primary-button"
                  disabled={focusBusy}
                  onClick={() => void onFocusTransition("complete")}
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
                  <strong>Nothing running · {tasks.length} blocks planned</strong>
                  <small>{idleNext.title} · {idleNext.estimateMinutes}m</small>
                </span>
                <button
                  className="secondary-button"
                  onClick={() =>
                    onStartFocus({
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
                  <button
                    className={
                      activeFocus
                        ? "plain-button queue-next-button"
                        : index === 0
                          ? "secondary-button"
                          : "plain-button"
                    }
                    disabled={Boolean(activeFocus && task.focusQueuePosition !== null)}
                    onClick={() =>
                      activeFocus
                        ? void onQueueTask(task, index === 0 ? "next" : "end")
                        : onStartFocus({
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
                </section>
              </div>
            </article>
          );
        })}
        <article className="stream-row planned add">
          <time />
          <div>
            <i />
            <button onClick={onOpenPalette}>
              Add to the day<span className="desktop-shortcut"> · ⌘K</span>
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

function DayTimeline({
  today,
  blocks,
  activities,
  activeFocus,
  focusNow
}: {
  today: string;
  blocks: TimeBlock[];
  activities: ActivityEntry[];
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
}) {
  const key = today.slice(0, 10);
  const todayBlocks = blocks.filter((block) => block.date.slice(0, 10) === key);
  return (
    <section className="day-view">
      <p className="view-explainer">
        Planned time and focused time share one grid so gaps and overages stay honest.
      </p>
      <div className="day-timeline-panel">
        <div className="timeline-corner" />
        <span className="timeline-column-label">Planned</span>
        <span className="timeline-column-label focused">Focused</span>
        <div className="timeline-hours">
          {Array.from({ length: 10 }, (_, index) => (
            <span key={index}>{formatHour(index + 8)}</span>
          ))}
        </div>
        <div className="timeline-column">
          {todayBlocks.map((block) => {
            const start = parseTime(block.startTime);
            const end = parseTime(block.endTime);
            return (
              <article
                className="planned-block"
                key={block.id}
                style={timelinePosition(start, Math.max(15, end - start))}
              >
                <strong>{block.title}</strong>
                <small>
                  {block.startTime}–{block.endTime}
                </small>
              </article>
            );
          })}
          <button className="timeline-empty" style={timelinePosition(15 * 60, 60)}>
            Nothing planned · block 3:00–4:00
          </button>
        </div>
        <div className="timeline-column actual">
          {activities.map((activity) => {
            const date = new Date(activity.startedAt);
            const start = date.getHours() * 60 + date.getMinutes();
            return (
              <article
                className="focused-block"
                key={activity.id}
                style={timelinePosition(start, activity.durationMinutes)}
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
                Math.max(20, Math.floor(focusElapsedSeconds(activeFocus, focusNow) / 60))
              )}
            >
              <strong>{activeFocus.label}</strong>
              <small>running</small>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

function DayMatrix({
  tasks,
  today,
  projects,
  arrangement,
  preferredProjectId,
  activeTaskId,
  onStartFocus,
  onUpdateTask
}: {
  tasks: Task[];
  today: string;
  projects: Map<string, ProjectSummary>;
  arrangement: BacklogArrange;
  preferredProjectId?: string | null;
  activeTaskId: string | null;
  onStartFocus: (target: FocusTarget) => void;
  onUpdateTask: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<unknown>;
}) {
  const mode = arrangement === "figure" ? "figure" : "tables";
  const [layout, setLayout] = useState<"figure" | "tables">(mode);
  const [phase, setPhase] = useState<"closed" | "open">("open");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previousStageWidth = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const visibleTasks = tasks.filter((task) => task.status !== "DONE").slice(0, 60);
  const groups = matrixGroups(
    visibleTasks,
    today,
    projects,
    arrangement,
    preferredProjectId
  );
  const tableGeometry = matrixTableGeometry(groups, stageWidth);
  const stageHeight = tableGeometry.height;

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    },
    []
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (previousStageWidth.current === null) {
        previousStageWidth.current = width;
        setStageWidth(width);
        return;
      }
      if (Math.abs(previousStageWidth.current - width) < 0.5) return;
      previousStageWidth.current = width;
      markDocumentResizing();
      setStageWidth(width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next = arrangement === "figure" ? "figure" : "tables";
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    if (next === "tables") {
      setLayout("tables");
      setPhase("closed");
      transitionTimer.current = window.setTimeout(() => setPhase("open"), 190);
    } else {
      setPhase("closed");
      transitionTimer.current = window.setTimeout(() => {
        setLayout("figure");
        setPhase("open");
      }, 130);
    }
  }, [arrangement]);

  const calloutTask =
    visibleTasks.find((task) => task.id === (hovered ?? selected)) ?? null;
  const selectedTask = visibleTasks.find((task) => task.id === selected) ?? null;

  return (
    <section className="day-view matrix-5a">
      <div
        ref={stageRef}
        className={`matrix-stage matrix-layout-${layout} matrix-phase-${phase}`}
        style={{ height: layout === "tables" ? `${stageHeight}px` : "386px" }}
      >
        <div className="matrix-figure-furniture">
          <span className="matrix-axis-y">Importance →</span>
          <div className="matrix-figure-plot">
            <span className="figure-quadrant schedule">Schedule</span>
            <span className="figure-quadrant do-now">Do now</span>
            <span className="figure-quadrant later">Later</span>
            <span className="figure-quadrant quick">Quick wins</span>
          </div>
          <div className="matrix-axis-x">
            <span>7+ days out</span>
            <strong>Urgency →</strong>
            <span>due today</span>
          </div>
          {calloutTask && (
            <div
              className="matrix-hover-callout"
              style={{
                top: `${matrixFigurePoint(calloutTask, today, stageWidth).y - 18}px`,
                left: `${Math.min(520, stageWidth || 520) + 24}px`
              }}
            >
              <strong>{calloutTask.title}</strong>
              <span>
                {taskQuadrant(calloutTask, today).shortLabel} ·{" "}
                {matrixProjectName(calloutTask, projects)} ·{" "}
                {formatMinutes(calloutTask.estimateMinutes)}
                {calloutTask.deadline
                  ? ` · due ${formatShortDate(calloutTask.deadline)}`
                  : ""}
              </span>
            </div>
          )}
        </div>
        {groups.map((group) => {
          const geometry = tableGeometry.groups.get(group.id);
          if (!geometry) return null;
          return (
            <header
              className={`matrix-table-heading arrangement-${arrangement} quadrant-${group.id}`}
              key={group.id}
              style={{ top: `${geometry.top}px` }}
            >
              {group.rank ? (
                <span>{group.rank}</span>
              ) : group.dotColor ? (
                <span className="matrix-project-dot" style={{ background: group.dotColor }} />
              ) : (
                <span aria-hidden="true" />
              )}
              <div>
                <strong>{group.name}</strong>
                <small>{group.definition}</small>
              </div>
              <b>
                {group.tasks.length} ·{" "}
                {formatMinutes(
                  group.tasks.reduce((sum, task) => sum + task.estimateMinutes, 0)
                )}
              </b>
              <div className="matrix-column-heads">
                <span>Task</span>
                <span>Project</span>
                <span>Time</span>
                <span>Due</span>
              </div>
            </header>
          );
        })}
        {visibleTasks.map((task, index) => {
          const figure = matrixFigurePoint(task, today, stageWidth);
          const table = tableGeometry.tasks.get(task.id) ?? { x: 14, y: 15 };
          const color = matrixProjectColor(task.projectId);
          const position = layout === "tables" ? table : figure;
          const diameter =
            layout === "tables"
              ? 8
              : Math.min(36, Math.max(10, 9 + task.estimateMinutes * 0.13));
          const dueSoon = daysUntilTaskDeadline(task, today) <= 1;
          return (
            <button
              key={task.id}
              className={`matrix-persistent-task ${activeTaskId === task.id ? "running" : ""} ${dueSoon ? "due-soon" : ""}`}
              style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${diameter}px`,
                height: `${diameter}px`,
                backgroundColor: color,
                transitionDelay: `${(index % 5) * 22}ms`
              }}
              aria-label={`${task.title}, ${matrixProjectName(task, projects)}, ${formatMinutes(task.estimateMinutes)}`}
              onMouseEnter={() => setHovered(task.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(task.id)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                if (mode === "figure") {
                  setSelected(task.id);
                  return;
                }
                onStartFocus({
                  taskId: task.id,
                  projectId: task.projectId ?? undefined,
                  label: task.title,
                  plannedMinutes: task.estimateMinutes
                });
              }}
            >
              <span className="matrix-row-unroll">
                <span className="matrix-row-content">
                  <strong>{task.title}</strong>
                  <span className="matrix-row-project">
                    <i style={{ backgroundColor: color }} />
                    {matrixProjectName(task, projects)}
                  </span>
                  <time>{formatMinutes(task.estimateMinutes)}</time>
                  <time className={task.deadline ? "has-deadline" : ""}>
                    {task.deadline ? formatShortDate(task.deadline) : "—"}
                  </time>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {mode === "figure" && selectedTask && (
        <div className="matrix-selection-caption">
          <span>
            <strong>{selectedTask.title}</strong>
            <small>
              {taskQuadrant(selectedTask, today).shortLabel} ·{" "}
              {matrixProjectName(selectedTask, projects)} ·{" "}
              {formatMinutes(selectedTask.estimateMinutes)}
            </small>
          </span>
          <label className="pick-day-button compact">
            Pick day
            <input
              type="date"
              aria-label={`Pick a day for ${selectedTask.title}`}
              onChange={(event) => {
                if (event.target.value) {
                  void onUpdateTask(selectedTask.id, {
                    date: event.target.value,
                    scheduleSource: "backlog-matrix-date"
                  });
                }
              }}
            />
          </label>
          <button
            className="secondary-button"
            onClick={() =>
              void onUpdateTask(selectedTask.id, {
                date: today.slice(0, 10),
                scheduleSource: "backlog-matrix-today"
              })
            }
          >
            Today
          </button>
        </div>
      )}
    </section>
  );
}

function BacklogPage({
  figureArrangement,
  tasks,
  projects,
  today,
  arrangement,
  onArrangementChange,
  scopeProjectId,
  onClearScope,
  onOpenProject,
  activeTaskId,
  onStartFocus,
  onUpdateTask,
  onOpenPalette
}: {
  figureArrangement: boolean;
  tasks: Task[];
  projects: Map<string, ProjectSummary>;
  today: string;
  arrangement: BacklogArrange;
  onArrangementChange: (arrangement: BacklogArrange) => void;
  scopeProjectId: string | null;
  onClearScope: () => void;
  onOpenProject: (id: string) => void;
  activeTaskId: string | null;
  onStartFocus: (target: FocusTarget) => void;
  onUpdateTask: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<unknown>;
  onOpenPalette: () => void;
}) {
  const effectiveArrangement =
    !figureArrangement && arrangement === "figure" ? "quadrant" : arrangement;
  const arrangements: Array<[BacklogArrange, string]> = figureArrangement
    ? [
        ["quadrant", "Quadrant"],
        ["figure", "Figure"],
        ["project", "Project"],
        ["due", "Due"]
      ]
    : [
        ["quadrant", "Quadrant"],
        ["project", "Project"],
        ["due", "Due"]
      ];

  const explainer =
    effectiveArrangement === "figure"
      ? "Figure — position is the grouping. Hover a dot for its title."
      : effectiveArrangement === "quadrant"
        ? "Ranked by what deserves attention first. Deadlines lead within each quadrant, then importance."
        : effectiveArrangement === "project"
          ? "Grouped by project — all of them, separated."
          : "Grouped by when a decision is due: Today, Next three days, Later this week, then No deadline.";

  return (
    <div className="backlog-page page-stack">
      <PageHeader
        eyebrow={`Defined, not scheduled · ${tasks.length}`}
        title="Backlog"
        actions={
          tasks.length ? (
            <ArrangementControl
              value={effectiveArrangement}
              options={arrangements}
              onChange={onArrangementChange}
            />
          ) : null
        }
      />
      {!tasks.length ? (
        <section className="backlog-empty-state">
          <h2>Everything defined has a day</h2>
          <p>
            Work lands here when you capture it without choosing a date. An empty
            backlog is the healthy state, not a gap to fill.
          </p>
          <button className="secondary-button" onClick={onOpenPalette}>
            <Plus size={14} />
            Capture something<span className="desktop-shortcut"> · ⌘K</span>
          </button>
          <small>
            Arrange is hidden while the backlog is empty — there is nothing to regroup.
          </small>
        </section>
      ) : (
        <>
          <p className="view-explainer">
            Arrange the same {tasks.length} {tasks.length === 1 ? "task" : "tasks"} by
            pressure, project or deadline — nothing is ever filtered out.
          </p>
          <p className="backlog-arrangement-note">{explainer}</p>
          {scopeProjectId && projects.get(scopeProjectId) && (
            <div className="backlog-scope-bar">
              <span>
                All backlog tasks are visible ·{" "}
                <strong>{projects.get(scopeProjectId)?.name} first</strong>
              </span>
              <div>
                <button className="text-button" onClick={onClearScope}>
                  Restore project order
                </button>
                <button
                  className="secondary-button"
                  onClick={() => onOpenProject(scopeProjectId)}
                >
                  Back to project
                </button>
              </div>
            </div>
          )}
          <DayMatrix
            tasks={tasks}
            today={today}
            projects={projects}
            arrangement={effectiveArrangement}
            preferredProjectId={scopeProjectId}
            activeTaskId={activeTaskId}
            onStartFocus={onStartFocus}
            onUpdateTask={onUpdateTask}
          />
        </>
      )}
    </div>
  );
}

function JournalPage({
  today,
  view,
  onViewChange,
  diary,
  notes,
  materials,
  projects,
  onDiaryChange,
  onSaveDiary,
  onSaveError,
  onSaveRecovered,
  newNote,
  noteTags,
  onNewNoteChange,
  onNoteTagsChange,
  onAddNote,
  materialTitle,
  materialUrl,
  materialNotes,
  onMaterialTitleChange,
  onMaterialUrlChange,
  onMaterialNotesChange,
  onAddMaterial
}: {
  today: string;
  view: JournalView;
  onViewChange: (view: JournalView) => void;
  diary: Diary;
  notes: Note[];
  materials: Material[];
  projects: Map<string, ProjectSummary>;
  onDiaryChange: <K extends keyof Diary>(key: K, value: Diary[K]) => void;
  onSaveDiary: (diary: Diary) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  newNote: string;
  noteTags: string;
  onNewNoteChange: (value: string) => void;
  onNoteTagsChange: (value: string) => void;
  onAddNote: () => Promise<void>;
  materialTitle: string;
  materialUrl: string;
  materialNotes: string;
  onMaterialTitleChange: (value: string) => void;
  onMaterialUrlChange: (value: string) => void;
  onMaterialNotesChange: (value: string) => void;
  onAddMaterial: () => Promise<void>;
}) {
  const diarySave = useSaveState<Diary>({
    value: diary,
    save: onSaveDiary,
    isEqual: diariesEqual,
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  });

  function updateDiary<K extends keyof Diary>(key: K, value: Diary[K]) {
    diarySave.setDraft({ ...diarySave.draft, [key]: value });
    onDiaryChange(key, value);
  }

  return (
    <div className="journal-page page-stack">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title="Journal"
        actions={
          <SegmentedControl
            value={view}
            options={[
              ["daily", "Daily page"],
              ["notes", `Notes · ${notes.length}`],
              ["references", `References · ${materials.length}`]
            ]}
            onChange={onViewChange}
          />
        }
      />
      {view === "daily" && (
        <div className="journal-grid">
          <section className="panel daily-page-card">
            <div className="journal-card-heading">
              <h2>Daily page</h2>
              <SaveStateChip
                state={diarySave.state}
                onRetry={() => void diarySave.flush(true)}
              />
            </div>
            <textarea
              value={diarySave.draft.content}
              onChange={(event) => updateDiary("content", event.target.value)}
              placeholder="Write a few lines about the day."
              {...diarySave.inputProps}
            />
            <div className="journal-footer">
              <label>
                Mood · {diarySave.draft.mood}/5
                <input
                  type="range"
                  aria-label="Mood"
                  min="1"
                  max="5"
                  value={diarySave.draft.mood}
                  onChange={(event) => updateDiary("mood", Number(event.target.value))}
                  {...diarySave.inputProps}
                />
              </label>
              <label>
                Energy · {diarySave.draft.energy}/5
                <input
                  type="range"
                  aria-label="Energy"
                  min="1"
                  max="5"
                  value={diarySave.draft.energy}
                  onChange={(event) => updateDiary("energy", Number(event.target.value))}
                  {...diarySave.inputProps}
                />
              </label>
              <button
                className="primary-button"
                onClick={() => void diarySave.flush(true)}
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </section>
          <aside className="journal-captured">
            <span className="eyebrow">Captured today</span>
            <NoteCards notes={notes.slice(0, 2)} projects={projects} />
            <button className="rail-link" onClick={() => onViewChange("notes")}>
              New note<span className="desktop-shortcut"> · ⌘K</span>
            </button>
            <span className="eyebrow references-label">References</span>
            <ReferenceCards materials={materials.slice(0, 3)} projects={projects} />
          </aside>
        </div>
      )}
      {view === "notes" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>New note</h2>
            <textarea
              id="new-note"
              value={newNote}
              onChange={(event) => onNewNoteChange(event.target.value)}
              placeholder="Capture a thought, decision, or reminder."
            />
            <input
              value={noteTags}
              onChange={(event) => onNoteTagsChange(event.target.value)}
              placeholder="Tags, comma separated"
            />
            <button className="primary-button" onClick={() => void onAddNote()}>
              <Plus size={14} />
              Save note
            </button>
          </section>
          <section>
            <NoteCards notes={notes} projects={projects} />
          </section>
        </div>
      )}
      {view === "references" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>Save reference</h2>
            <input
              value={materialTitle}
              onChange={(event) => onMaterialTitleChange(event.target.value)}
              placeholder="Title"
            />
            <input
              id="material-url"
              value={materialUrl}
              onChange={(event) => onMaterialUrlChange(event.target.value)}
              placeholder="URL"
            />
            <textarea
              value={materialNotes}
              onChange={(event) => onMaterialNotesChange(event.target.value)}
              placeholder="Why this matters"
            />
            <button className="primary-button" onClick={() => void onAddMaterial()}>
              <LinkIcon size={14} />
              Save reference
            </button>
          </section>
          <section>
            <ReferenceCards materials={materials} projects={projects} />
          </section>
        </div>
      )}
    </div>
  );
}

function ReviewPage({
  today,
  stats,
  projects,
  diary,
  summary,
  onDiaryChange,
  onSaveDiary,
  onSaveError,
  onSaveRecovered,
  onOpenProject
}: {
  today: string;
  stats: DayStat[];
  projects: ProjectSummary[];
  diary: Diary;
  summary: ReviewSummary;
  onDiaryChange: <K extends keyof Diary>(key: K, value: Diary[K]) => void;
  onSaveDiary: (diary: Diary) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  onOpenProject: (id: string) => void;
}) {
  const reflectionSave = useSaveState<Diary>({
    value: diary,
    save: onSaveDiary,
    isEqual: diariesEqual,
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  });
  const chartData = stats.map((stat) => ({
    ...stat,
    label: new Date(`${stat.day}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short"
    })
  }));
  const taskDone = stats.reduce((sum, stat) => sum + stat.completed, 0);
  const taskTotal = stats.reduce((sum, stat) => sum + stat.total, 0);
  const longestWhen = summary.longestStartedAt
    ? formatBlockMoment(summary.longestStartedAt)
    : "No completed focus block yet";
  const moved = projects.filter((project) => project.lastProgressAt).slice(0, 4);
  const recordedDays = chartData.filter((stat) => stat.actualHours > 0);
  const isFirstWeek = recordedDays.length === 1 && summary.focusedMinutes > 0;
  const sessionNote = [
    summary.pendingRecordSessions
      ? `${summary.pendingRecordSessions} awaiting optional details`
      : null,
    summary.cancelledSessions
      ? `${summary.cancelledSessions} cancelled`
      : null
  ]
    .filter(Boolean)
    .join(" · ") || "All sessions recorded";
  return (
    <div className="review-page page-stack">
      <PageHeader
        eyebrow={`Seven days ending ${formatShortDate(today)}`}
        title="Review"
        actions={
          <span className="review-focus-pill">
            {formatMinutes(summary.focusedMinutes)} focused this week
          </span>
        }
      />
      {summary.pendingRecordSessions > 0 && (
        <p className="review-pending-note" role="status">
          <Check size={14} />
          <span>
            <strong>{formatMinutes(summary.pendingRecordMinutes)} is already counted.</strong>{" "}
            {summary.pendingRecordSessions === 1 ? "This session" : "These sessions"} can
            receive optional notes and categories later.
          </span>
        </p>
      )}
      {isFirstWeek ? (
        <>
          <div className="review-metrics review-first-week-metrics">
            <ReviewMetric
              label="Recorded"
              value={formatMinutes(summary.focusedMinutes)}
              note="today, the only day with records"
            />
            <ReviewMetric
              label="Vs last week"
              value="—"
              note="needs a second week"
            />
            <ReviewMetric
              label="Completed"
              value={String(taskDone)}
              note={taskDone === 1 ? "task" : "tasks"}
            />
          </div>
          <section className="panel review-charts-panel review-first-week-chart">
            <span>Planned vs focused</span>
            <div className="review-first-week-plot">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid stroke="#eee8de" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis width={25} />
                  <Tooltip />
                  <Bar dataKey="plannedHours" fill="#d4c6aa" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="actualHours" fill="#637a5c" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p>
                One day of records. The axes stay so the shape of the week is visible
                as it fills — three more days and the week-over-week comparison appears.
              </p>
            </div>
            <small>
              {recordedDays[0]?.label ?? "One day"} only · the other days have no sessions
            </small>
          </section>
        </>
      ) : (
        <>
          <div className="review-metrics">
            <ReviewMetric
              label="Focused"
              value={formatMinutes(summary.focusedMinutes)}
              note="Protected focus time"
            />
            <ReviewMetric
              label="Sessions"
              value={String(summary.completedSessions)}
              note={sessionNote}
            />
            <ReviewMetric
              label="Tasks done"
              value={String(taskDone)}
              note={`of ${taskTotal} planned`}
            />
            <ReviewMetric
              label="Longest block"
              value={`${summary.longestMinutes}m`}
              note={longestWhen}
            />
          </div>
          <section className="panel review-charts-panel">
            <h2>Where the focus went</h2>
            <div className="review-charts">
              <div>
                <span>Focused hours per day</span>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={chartData}>
                    <CartesianGrid stroke="#eee8de" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis width={25} />
                    <Tooltip />
                    <Bar dataKey="actualHours" fill="#637a5c" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <span>Planned vs focused</span>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={chartData}>
                    <CartesianGrid stroke="#eee8de" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis width={25} />
                    <Tooltip />
                    <Bar dataKey="plannedHours" fill="#d4c6aa" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="actualHours" fill="#637a5c" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </>
      )}
      <div className="review-lower">
        <section className="panel moved-projects">
          <h2>Projects moved forward</h2>
          {moved.map((project) => (
            <button key={project.id} onClick={() => onOpenProject(project.id)}>
              <strong>{project.name}</strong>
              <div className="meter">
                <i style={{ width: `${project.progressPercent ?? 0}%` }} />
              </div>
              <small>
                {project.completedTaskCount}/{project.taskCount} tasks ·{" "}
                {formatInvestedMinutes(project.investedMinutes)} invested this week
              </small>
            </button>
          ))}
          {!moved.length && <p>No project movement recorded yet this week.</p>}
        </section>
        <section className="panel reflection-card">
          <div className="reflection-heading">
            <h2>Reflection</h2>
            <SaveStateChip
              state={reflectionSave.state}
              onRetry={() => void reflectionSave.flush(true)}
            />
          </div>
          <textarea
            value={reflectionSave.draft.reflection}
            onChange={(event) => {
              const value = event.target.value;
              reflectionSave.setDraft({
                ...reflectionSave.draft,
                reflection: value
              });
              onDiaryChange("reflection", value);
            }}
            placeholder="What worked, and what deserves protection next week?"
            {...reflectionSave.inputProps}
          />
          <button
            className="primary-button"
            onClick={() => void reflectionSave.flush(true)}
          >
            <Save size={14} />
            Save reflection
          </button>
        </section>
      </div>
    </div>
  );
}

function CommandPalette({
  projects,
  onClose,
  onStartFocus,
  onNewTask,
  onLogActivity,
  onWriteNote,
  onSaveReference,
  onOpenProject
}: {
  projects: ProjectSummary[];
  onClose: () => void;
  onStartFocus: () => void;
  onNewTask: () => void;
  onLogActivity: () => void;
  onWriteNote: () => void;
  onSaveReference: () => void;
  onOpenProject: (id: string) => void;
}) {
  return (
    <div className="palette-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search or add"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Plus size={17} />
          <input
            autoFocus
            aria-label="Search commands and tasks"
            placeholder="Type anything — a task, a note, a URL, “focus 50”"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-results">
          <button className="highlighted" onClick={onStartFocus}>
            <Timer size={16} />
            <span>Start a 50m focus block</span>
            <kbd>⌘⇧F</kbd>
          </button>
          <button onClick={onNewTask}>
            <Check size={16} />
            <span>New task for today</span>
            <kbd>⌘T</kbd>
          </button>
          <button onClick={onLogActivity}>
            <Clock3 size={16} />
            <span>Log an activity by hand</span>
            <kbd>⌘L</kbd>
          </button>
          <button onClick={onWriteNote}>
            <NotebookPen size={16} />
            <span>Write a note</span>
            <kbd>⌘N</kbd>
          </button>
          <button onClick={onSaveReference}>
            <LinkIcon size={16} />
            <span>Save a reference</span>
          </button>
          {projects.length > 0 && <span className="palette-label">Jump to</span>}
          {projects.slice(0, 3).map((project) => (
            <button key={project.id} onClick={() => onOpenProject(project.id)}>
              <FolderKanban size={16} />
              <span>{project.name}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityDialog({
  tasks,
  time,
  duration,
  category,
  taskId,
  note,
  error,
  onTimeChange,
  onDurationChange,
  onCategoryChange,
  onTaskChange,
  onNoteChange,
  onClose,
  onSave
}: {
  tasks: Task[];
  time: string;
  duration: string;
  category: string;
  taskId: string;
  note: string;
  error: string;
  onTimeChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onTaskChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="palette-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="activity-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-label="Log activity"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">Captured today</span>
            <h2>Log activity</h2>
          </div>
          <button className="text-button" onClick={onClose}>Close</button>
        </div>
        <textarea
          autoFocus
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Record a small win or what moved forward."
        />
        <div className="activity-dialog-grid">
          <label>
            Time
            <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={duration}
              onChange={(event) => onDurationChange(event.target.value)}
            />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
              {activityCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Linked task
            <select value={taskId} onChange={(event) => onTaskChange(event.target.value)}>
              <option value="">No linked task</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" onClick={() => void onSave()}>
          <Plus size={14} />
          Add activity
        </button>
      </section>
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  actions
}: {
  eyebrow: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {actions}
    </header>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control">
      {options.map(([id, label]) => (
        <button
          key={id}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ArrangementControl({
  value,
  options,
  onChange
}: {
  value: BacklogArrange;
  options: Array<[BacklogArrange, string]>;
  onChange: (value: BacklogArrange) => void;
}) {
  function moveSelection(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = (index + direction + options.length) % options.length;
    const group = event.currentTarget.parentElement;
    onChange(options[nextIndex][0]);
    window.requestAnimationFrame(() => {
      group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
    });
  }

  return (
    <div className="arrange-control">
      <span>Arrange</span>
      <div
        className="segmented-control"
        role="radiogroup"
        aria-label="Arrange backlog by"
      >
        {options.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            tabIndex={value === id ? 0 : -1}
            className={value === id ? "active" : ""}
            onKeyDown={(event) => moveSelection(event, index)}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MiniFocusRing({
  session,
  now
}: {
  session: NonNullable<ReturnType<typeof useFocusSession>["active"]>;
  now: number;
}) {
  const elapsed = focusElapsedSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  return (
    <div
      className="mini-focus-ring"
      style={{
        background: `conic-gradient(var(--sage) ${progress}%, #e2e0d5 ${progress}% 100%)`
      }}
    >
      <span>{formatFocusClock(focusRemainingSeconds(session, now))}</span>
    </div>
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
  const optionLabels =
    tone === "urgent"
      ? ["Not urgent", "Slightly urgent", "Urgent", "Very urgent", "Critical urgency"]
      : [
          "Not important",
          "Slightly important",
          "Important",
          "Very important",
          "Critical importance"
        ];
  return (
    <div className={`score-dots ${tone}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={`score-${score} ${score <= value ? "selected" : ""}`}
          aria-label={optionLabels[score - 1]}
          aria-checked={score === value}
          tabIndex={score === value ? 0 : -1}
          role="radio"
          onClick={() => onChange(score)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const direction =
              event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
            const next = Math.min(5, Math.max(1, score + direction));
            const group = event.currentTarget.parentElement;
            onChange(next);
            window.requestAnimationFrame(() => {
              group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
            });
          }}
        />
      ))}
    </div>
  );
}

function NoteCards({
  notes,
  projects
}: {
  notes: Note[];
  projects: Map<string, ProjectSummary>;
}) {
  return (
    <div className="note-list">
      {notes.map((note) => (
        <article className="note-card" key={note.id}>
          <p>{note.content}</p>
          <small>
            {note.tags.map((tag) => `#${tag}`).join(" ")}
            {note.projectId && projects.get(note.projectId)
              ? ` · ${projects.get(note.projectId)?.name}`
              : ""}
          </small>
        </article>
      ))}
      {!notes.length && <p className="empty-copy">No notes captured today.</p>}
    </div>
  );
}

function ReferenceCards({
  materials,
  projects
}: {
  materials: Material[];
  projects: Map<string, ProjectSummary>;
}) {
  return (
    <div className="material-list">
      {materials.map((material) => (
        <a
          className="material-item"
          href={material.url}
          target="_blank"
          rel="noreferrer"
          key={material.id}
        >
          <span>{material.type}</span>
          <strong>{material.title}</strong>
          <small>
            {material.notes}
            {material.projectId && projects.get(material.projectId)
              ? ` · ${projects.get(material.projectId)?.name}`
              : ""}
          </small>
          <ExternalLink size={13} />
        </a>
      ))}
      {!materials.length && <p className="empty-copy">No references saved yet.</p>}
    </div>
  );
}

function ReviewMetric({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function timelinePosition(startMinutes: number, durationMinutes: number) {
  const top = ((startMinutes - 8 * 60) / 60) * 52;
  const height = Math.max(20, (durationMinutes / 60) * 52);
  return { top: `${top}px`, height: `${height}px` };
}

function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatHour(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric" });
}

type MatrixQuadrantId = "do-now" | "schedule" | "quick-wins" | "later";
type MatrixGroup = {
  id: string;
  rank?: number;
  name: string;
  definition: string;
  dotColor?: string;
  tasks: Task[];
};

function taskQuadrant(task: Task, today: string) {
  const important = task.importanceScore >= 3;
  const urgent = effectiveUrgentScore(task, today) >= 3;
  if (important && urgent) {
    return {
      id: "do-now" as const,
      label: "Do now — important and urgent",
      shortLabel: "Do now"
    };
  }
  if (important) {
    return {
      id: "schedule" as const,
      label: "Schedule — important, not urgent",
      shortLabel: "Schedule"
    };
  }
  if (urgent) {
    return {
      id: "quick-wins" as const,
      label: "Quick wins — urgent, less important",
      shortLabel: "Quick wins"
    };
  }
  return {
    id: "later" as const,
    label: "Later — neither urgent nor important",
    shortLabel: "Later"
  };
}

function matrixGroups(
  tasks: Task[],
  today: string,
  projects: Map<string, ProjectSummary>,
  arrangement: BacklogArrange,
  preferredProjectId?: string | null
): MatrixGroup[] {
  if (arrangement === "project") {
    const projectIds = [
      ...new Set(tasks.map((task) => task.projectId ?? "standalone"))
    ].sort((a, b) => {
      if (a === preferredProjectId) return -1;
      if (b === preferredProjectId) return 1;
      return (
        a === "standalone" ? "Standalone" : projects.get(a)?.name ?? "Project"
      ).localeCompare(
        b === "standalone" ? "Standalone" : projects.get(b)?.name ?? "Project"
      );
    });
    return projectIds.map((projectId) => ({
      id: `project-${projectId}`,
      name:
        projectId === "standalone"
          ? "Standalone"
          : projects.get(projectId)?.name ?? "Project",
      definition:
        projectId === "standalone"
          ? "Independent work"
          : "Project work · all unscheduled tasks",
      dotColor: matrixProjectColor(projectId === "standalone" ? null : projectId),
      tasks: sortBacklogGroup(
        tasks.filter((task) => (task.projectId ?? "standalone") === projectId)
      )
    }));
  }

  if (arrangement === "due") {
    const definitions = [
      {
        id: "due-today",
        name: "Today",
        definition: "Due now",
        includes: (task: Task) => Boolean(task.deadline) && daysUntilTaskDeadline(task, today) <= 0
      },
      {
        id: "due-next-three",
        name: "Next three days",
        definition: "Close enough to decide",
        includes: (task: Task) => {
          const days = daysUntilTaskDeadline(task, today);
          return Boolean(task.deadline) && days > 0 && days <= 3;
        }
      },
      {
        id: "due-later-week",
        name: "Later this week",
        definition: "Visible, not immediate",
        includes: (task: Task) => Boolean(task.deadline) && daysUntilTaskDeadline(task, today) > 3
      },
      {
        id: "due-none",
        name: "No deadline",
        definition: "Date it or drop it",
        includes: (task: Task) => !task.deadline
      }
    ];
    return definitions
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        definition: definition.definition,
        tasks: tasks
          .filter(definition.includes)
          .sort(
            (a, b) =>
              b.importanceScore - a.importanceScore ||
              b.urgentScore - a.urgentScore ||
              a.sortOrder - b.sortOrder
          )
      }))
      .filter((group) => group.tasks.length > 0);
  }

  const definitions: Array<{
    id: MatrixQuadrantId;
    rank: number;
    name: string;
    definition: string;
  }> = [
    { id: "do-now", rank: 1, name: "Do now", definition: "Important and urgent" },
    { id: "schedule", rank: 2, name: "Schedule", definition: "Important, not urgent" },
    { id: "quick-wins", rank: 3, name: "Quick wins", definition: "Urgent, less important" },
    { id: "later", rank: 4, name: "Later", definition: "Neither" }
  ];
  return definitions.map((definition) => ({
    ...definition,
    tasks: sortBacklogGroup(
      tasks.filter((task) => taskQuadrant(task, today).id === definition.id)
    )
  }));
}

function sortBacklogGroup(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    if (a.deadline && b.deadline) {
      return (
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime() ||
        b.importanceScore - a.importanceScore
      );
    }
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.importanceScore - a.importanceScore || a.sortOrder - b.sortOrder;
  });
}

function matrixTableGeometry(groups: MatrixGroup[], stageWidth = 0) {
  const groupGeometry = new Map<string, { top: number }>();
  const taskGeometry = new Map<string, { x: number; y: number }>();
  const rowOrigin = stageWidth > 0 ? Math.min(14, stageWidth / 2) : 14;
  let top = 0;
  for (const group of groups) {
    groupGeometry.set(group.id, { top });
    group.tasks.forEach((task, index) => {
      taskGeometry.set(task.id, {
        x: rowOrigin,
        y: top + 63 + index * 30 + 15
      });
    });
    top += 78 + group.tasks.length * 30 + 26;
  }
  return {
    groups: groupGeometry,
    tasks: taskGeometry,
    height: Math.max(380, top - 26)
  };
}

function matrixFigurePoint(task: Task, today: string, stageWidth = 520) {
  const days = daysUntilTaskDeadline(task, today);
  const plotWidth = Math.min(520, stageWidth || 520);
  const x =
    20 +
    (1 - Math.min(7, Math.max(0, days)) / 7) *
      Math.max(0, plotWidth - 40);
  const importance = Math.min(5, Math.max(1, task.importanceScore));
  const y = 20 + ((5 - importance) / 4) * 300;
  return { x, y };
}

function daysUntilTaskDeadline(task: Task, today: string) {
  if (!task.deadline) return 7;
  return Math.max(
    0,
    Math.ceil(
      (startOfDay(new Date(task.deadline)) - startOfDay(new Date(today))) / 86400000
    )
  );
}

function matrixProjectColor(projectId: string | null) {
  const palette = ["#4f76a8", "#96667c", "#8a6a3c", "#777066"];
  if (!projectId) return palette[3];
  let hash = 0;
  for (const character of projectId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function matrixProjectName(
  task: Task,
  projects: Map<string, ProjectSummary>
) {
  return task.projectId ? projects.get(task.projectId)?.name ?? "Project" : "Standalone";
}

function coordinateToScore(value: number) {
  return Math.min(5, Math.max(1, Math.round(value * 4 + 1)));
}

function scoreToCoordinate(score: number) {
  return ((Math.min(5, Math.max(1, score)) - 1) / 4) * 86 + 7;
}

function effectiveUrgentScore(task: Task, today: string) {
  if (!task.deadline) return task.urgentScore;
  const days = Math.ceil(
    (startOfDay(new Date(task.deadline)) - startOfDay(new Date(today))) / 86400000
  );
  const deadlineScore =
    days <= 1 ? 5 : days <= 3 ? 4 : days <= 7 ? 3 : days <= 14 ? 2 : 1;
  return Math.max(task.urgentScore, deadlineScore);
}

function startOfDay(value: Date) {
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatBacklogDue(value: string | null, today: string) {
  if (!value) return "—";
  const days = Math.ceil(
    (startOfDay(new Date(value)) - startOfDay(new Date(today))) / 86400000
  );
  if (days <= 0) return "Today";
  return formatShortDate(value);
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatBlockMoment(value: string) {
  const date = new Date(value);
  const part =
    date.getHours() < 12
      ? "morning"
      : date.getHours() < 17
        ? "afternoon"
        : "evening";
  return `${date.toLocaleDateString("en-US", { weekday: "long" })} ${part}`;
}

function formatClockTime(value: Date) {
  return value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function numberWord(value: number) {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
  return words[value] ?? String(value);
}
