"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CalendarDays,
  Circle,
  DatabaseBackup,
  FileText,
  FolderKanban,
  Layers3,
  LayoutDashboard,
  Library,
  Menu,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { DataManagementDialog } from "@/modules/data-ops/ui/data-management-dialog";
import { DayPage } from "@/components/day-workspace";
import { safeTimeBlockDurationMinutes } from "@/components/day-workspace-helpers";
import {
  formatLongLocalDateKey,
  formatMinutes
} from "@/components/dashboard-formatters";
import {
  ActivityDraft,
  ActivityEntry,
  ActivityTaskOption,
  PendingMutation,
  isActivityResponse,
  mutationIdFor
} from "@/components/activity-records";
import { useActivityCapture } from "@/components/use-activity-capture";
import { ProjectsWorkspace } from "@/components/projects-workspace";
import { ReviewPage } from "@/components/review-workspace";
import { FocusDraft, FocusRail } from "@/modules/focus/ui/focus-rail";
import { useFocusSession } from "@/components/focus-session-provider";
import {
  BacklogPage,
  FirstRunPage,
  TodayPage,
  describeTaskMove,
  useBacklogPage,
  useTodayPage,
  type FocusTarget,
  type Task
} from "@/modules/planning/ui";
import { useViewedDay } from "@/components/use-viewed-day";
import {
  JournalPage,
  taskProjectIdFor,
  useJournalPage,
  type Diary,
  type MaterialCaptureDraft,
  type NoteCaptureDraft
} from "@/modules/journal/ui";
import {
  TimeBlockDialog,
  type TimeBlockEditorDraft,
  type TimeBlockErrorField
} from "@/components/time-block-dialog";
import { useLayoutMode } from "@/components/use-layout-mode";
import {
  DEFAULT_FOCUS_MINUTES,
  focusRemainingSeconds,
  formatFocusClock
} from "@/lib/focus-domain";
import {
  localDateKey,
  millisecondsUntilNextLocalDay,
  parseLocalDate
} from "@/lib/dates";
import {
  inferMaterialTitle,
  inferMaterialType,
  normalizeNoteTags
} from "@/lib/journal-domain";
import {
  isJournalMaterialRecord as isMaterialResponse,
  isJournalNoteRecord as isNoteResponse,
  type JournalMaterialRecord,
  type JournalNoteRecord
} from "@/lib/journal-records";
import { ACTIVITY_CATEGORY_MAX_LENGTH } from "@/lib/activity-categories";
import { ProjectSummary } from "@/lib/project-domain";
import {
  resolvePalette,
  type PaletteItem
} from "@/lib/command-palette";
import {
  isTimeBlockRecord,
  minutesToTimeBlockTime,
  TIME_BLOCK_LAST_MINUTE,
  TIME_BLOCK_SLOT_INTERVAL_MINUTES,
  type TimeBlockRecord,
  type TimeBlockTaskSummary
} from "@/lib/time-blocks";
import type { QueuePlacement } from "@/lib/focus-queue";

type Screen =
  | "today"
  | "day-stream"
  | "day-timeline"
  | "projects"
  | "backlog"
  | "journal"
  | "review";
type DayView = "stream" | "timeline";
type TimeBlockEditor = {
  id: string | null;
  date: string;
  originalTask: TimeBlockTaskSummary | null;
  linkedTask: TimeBlockTaskSummary | null;
  draft: TimeBlockEditorDraft;
};
type PaletteTaskRecord = Pick<
  Task,
  | "id"
  | "title"
  | "date"
  | "estimateMinutes"
  | "sortOrder"
  | "focusQueuePosition"
  | "projectId"
>;
type Note = JournalNoteRecord;

type Review = {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  nextPeriodIntention: string;
  persisted: boolean;
};

type Material = JournalMaterialRecord;

type TimeBlock = TimeBlockRecord;


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
  recordedMinutes: number;
  focusedMinutes: number;
  categoryMinutes: Array<{
    category: string;
    minutes: number;
  }>;
  completedTaskCount: number;
  noteCount: number;
  materialCount: number;
  diaryDayCount: number;
  averageMood: number | null;
  averageEnergy: number | null;
  movedProjectCount: number;
  pendingEnrichmentSessions: number;
  pendingEnrichmentMinutes: number;
};

type Bootstrap = {
  today: string;
  todayKey: string;
  earliestDayKey: string;
  dayViewForwardWeeks: number;
  workspaceEmpty: boolean;
  tasks: Task[];
  paletteTasks: PaletteTaskRecord[];
  notes: Note[];
  diary: Diary;
  materials: Material[];
  timeBlocks: TimeBlock[];
  activities: ActivityEntry[];
  activityCategorySuggestions: string[];
  projects: ProjectSummary[];
  unfinishedTasks: Task[];
  stats: DayStat[];
  review: Review;
  reviewSummary: ReviewSummary;
};

type BootstrapFailure = {
  code: string;
  message: string;
};

const GENERIC_BOOTSTRAP_FAILURE =
  "Dayflow could not open its local data. Check that the local server is running, then try again.";

class BootstrapRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BootstrapRequestError";
    this.code = code;
  }
}

function describeBootstrapFailure(error: unknown): BootstrapFailure {
  if (error instanceof BootstrapRequestError) {
    return { code: error.code, message: error.message };
  }

  return { code: "BOOTSTRAP_UNAVAILABLE", message: GENERIC_BOOTSTRAP_FAILURE };
}

const emptyNoteCaptureDraft: NoteCaptureDraft = {
  content: "",
  tags: "",
  taskId: "",
  projectId: ""
};
const emptyMaterialCaptureDraft: MaterialCaptureDraft = {
  title: "",
  url: "",
  notes: "",
  taskId: "",
  noteId: "",
  projectId: ""
};

const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "day", label: "Log", icon: CalendarDays },
  { id: "projects", label: "Projects", icon: Layers3 },
  { id: "backlog", label: "Backlog", icon: Circle },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "review", label: "Review", icon: Sparkles }
] as const;

function stringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isTaskResponse(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
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
    (task.focusQueuePosition === null ||
      Number.isInteger(task.focusQueuePosition)) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}


function timeBlockErrorFieldFrom(
  value: unknown
): TimeBlockErrorField | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as { field?: unknown }).field;
  return ["title", "startTime", "endTime", "taskId"].includes(
    String(field)
  )
    ? (field as TimeBlockErrorField)
    : null;
}

function isPersistedDiaryResponse(value: unknown): value is Diary & {
  id: string;
  persisted: true;
} {
  if (!value || typeof value !== "object") return false;
  const diary = value as Partial<Diary>;
  return (
    typeof diary.id === "string" &&
    typeof diary.date === "string" &&
    typeof diary.content === "string" &&
    typeof diary.reflection === "string" &&
    Number.isInteger(diary.mood) &&
    Number.isInteger(diary.energy) &&
    diary.persisted === true
  );
}

function isPersistedReviewResponse(value: unknown): value is Review & {
  id: string;
  persisted: true;
} {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<Review>;
  return (
    typeof review.id === "string" &&
    typeof review.periodStart === "string" &&
    typeof review.periodEnd === "string" &&
    typeof review.narrative === "string" &&
    typeof review.nextPeriodIntention === "string" &&
    review.persisted === true
  );
}

function isFocusQueueResponse(
  value: unknown
): value is { tasks: Task[] } {
  if (!value || typeof value !== "object") return false;
  const result = value as { tasks?: unknown };
  return Array.isArray(result.tasks) && result.tasks.every(isTaskResponse);
}

function isTaskReorderResponse(
  value: unknown
): value is { ok: true; tasks: Task[] } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    isFocusQueueResponse(value)
  );
}


export function Dashboard() {
  const focus = useFocusSession();
  const { mode: layoutMode, figureArrangement, wideFocusRail } = useLayoutMode();
  const compactLayout = layoutMode !== "desktop";
  const phoneLayout = layoutMode === "phone";
  const [data, setData] = useState<Bootstrap | null>(null);
  const [bootstrapFailure, setBootstrapFailure] =
    useState<BootstrapFailure | null>(null);
  const [screen, setScreen] = useState<Screen>("today");
  const [railExpanded, setRailExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const projectById = useMemo(
    () => new Map((data?.projects ?? []).map((project) => [project.id, project])),
    [data]
  );
  const journal = useJournalPage(
    screen === "journal",
    data && {
      today: data.today,
      diary: data.diary,
      notes: data.notes,
      materials: data.materials,
      tasks: data.tasks,
      paletteTasks: data.paletteTasks,
      projects: projectById
    }
  );
  const [newTask, setNewTask] = useState("");
  const [taskCreatePending, setTaskCreatePending] = useState(false);
  const [noteDraft, setNoteDraft] = useState<NoteCaptureDraft>(
    emptyNoteCaptureDraft
  );
  const [noteSaving, setNoteSaving] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<MaterialCaptureDraft>(
    emptyMaterialCaptureDraft
  );
  const [materialSaving, setMaterialSaving] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [focusDraft, setFocusDraft] = useState<FocusDraft | null>(null);
  const [timeBlockEditor, setTimeBlockEditor] =
    useState<TimeBlockEditor | null>(null);
  const [timeBlockError, setTimeBlockError] = useState("");
  const [timeBlockErrorField, setTimeBlockErrorField] =
    useState<TimeBlockErrorField | null>(null);
  const [timeBlockSaving, setTimeBlockSaving] = useState(false);
  const [dismissedUnfinished, setDismissedUnfinished] = useState<string[]>([]);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [firstRunSeen, setFirstRunSeen] = useState<boolean | null>(null);
  const [appAnnouncement, setAppAnnouncement] = useState("");
  const [appError, setAppError] = useState("");
  const taskSaveWasInError = useRef(false);
  const diarySaveWasInError = useRef(false);
  const reviewSaveWasInError = useRef(false);
  const taskCreateWasInError = useRef(false);
  const noteCreateWasInError = useRef(false);
  const materialCreateWasInError = useRef(false);
  const taskCreateMutation = useRef<PendingMutation | null>(null);
  const noteCreateMutation = useRef<PendingMutation | null>(null);
  const materialCreateMutation = useRef<PendingMutation | null>(null);
  const timeBlockCreateMutation = useRef<PendingMutation | null>(null);
  const paletteOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let dayRefreshTimer: number | null = null;
    let disposed = false;

    function scheduleDayRefresh() {
      dayRefreshTimer = window.setTimeout(() => {
        void refresh()
          .catch(() => {
            if (disposed) return;
            setAppError(
              "Dayflow could not refresh for the new day. Reload to try again."
            );
            setAppAnnouncement("The new day could not be loaded.");
          })
          .finally(() => {
            if (!disposed) scheduleDayRefresh();
          });
      }, millisecondsUntilNextLocalDay() + 100);
    }

    activity.initializeClock();
    setFirstRunSeen(window.localStorage.getItem("dayflow-first-run-seen") === "1");
    void refresh().catch((error: unknown) => {
      if (!disposed) setBootstrapFailure(describeBootstrapFailure(error));
    });
    scheduleDayRefresh();

    return () => {
      disposed = true;
      if (dayRefreshTimer !== null) window.clearTimeout(dayRefreshTimer);
    };
  }, []);

  useEffect(() => {
    if (focus.activityRevision > 0) void refresh();
  }, [focus.activityRevision]);

  useEffect(() => {
    if (focus.retryNext) setRailExpanded(true);
  }, [focus.retryNext]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) {
          dismissCommandPalette();
        } else {
          openCommandPalette();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!focus.active) {
          setFocusDraft({ revision: Date.now(), plannedMinutes: DEFAULT_FOCUS_MINUTES });
          if (screen !== "today") setRailExpanded(true);
        }
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [focus.active, paletteOpen, screen]);

  async function refresh() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        result &&
        typeof result === "object" &&
        "code" in result &&
        typeof result.code === "string"
          ? result.code
          : "BOOTSTRAP_UNAVAILABLE";
      const message =
        result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : GENERIC_BOOTSTRAP_FAILURE;
      throw new BootstrapRequestError(code, message);
    }
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.workspaceEmpty !== "boolean" ||
      !Array.isArray(result.tasks) ||
      typeof result.todayKey !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.todayKey) ||
      !Array.isArray(result.timeBlocks) ||
      !result.timeBlocks.every(isTimeBlockRecord) ||
      !Array.isArray(result.activities) ||
      !result.activities.every(isActivityResponse) ||
      !Array.isArray(result.activityCategorySuggestions) ||
      !result.activityCategorySuggestions.every(
        (category: unknown) => typeof category === "string"
      )
    ) {
      throw new BootstrapRequestError(
        "INVALID_BOOTSTRAP_RESPONSE",
        "Dayflow received an invalid local data response. Try again."
      );
    }
    setData(result as Bootstrap);
    setBootstrapFailure(null);
  }

  async function retryBootstrap() {
    setBootstrapFailure(null);
    try {
      if (!(await focus.reload())) {
        throw new BootstrapRequestError(
          "STARTUP_UNAVAILABLE",
          GENERIC_BOOTSTRAP_FAILURE
        );
      }
      await refresh();
    } catch (error) {
      setBootstrapFailure(describeBootstrapFailure(error));
    }
  }

  async function refreshAfterConfirmedMutation() {
    try {
      await refresh();
      return true;
    } catch {
      setAppError(
        "Your change was saved, but Dayflow could not refresh the latest view. Reload to try again."
      );
      setAppAnnouncement("Saved, but the latest view could not be refreshed.");
      return false;
    }
  }

  const todayTasks = useMemo(() => {
    if (!data) return [];
    const key = data.todayKey;
    return data.tasks
      .filter(
        (task) =>
          taskDateLocalKey(task.date) === key
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  const openTodayTasks = todayTasks.filter((task) => task.status !== "DONE");
  const doneTodayTasks = todayTasks.filter((task) => task.status === "DONE");
  const activityKnownTasks = useMemo(
    () => [...(data?.tasks ?? []), ...(data?.paletteTasks ?? [])],
    [data?.paletteTasks, data?.tasks]
  );
  const activity = useActivityCapture({
    todayKey: data?.todayKey ?? null,
    todayTasks,
    knownTasks: activityKnownTasks,
    replaceActivity: (saved) =>
      setData((current) =>
        current
          ? {
              ...current,
              activities: current.activities
                .map((entry) => (entry.id === saved.id ? saved : entry))
                .sort(
                  (left, right) =>
                    new Date(right.startedAt).getTime() -
                    new Date(left.startedAt).getTime()
                )
            }
          : current
      ),
    announce: setAppAnnouncement,
    refreshAfterConfirmedMutation
  });
  const backlogTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((task) => !task.date && task.status !== "DONE")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );
  const backlog = useBacklogPage(
    figureArrangement,
    data && {
      tasks: backlogTasks,
      projects: projectById,
      today: data.today
    }
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
  const today = useTodayPage(
    data && {
      today: data.today,
      tasks: todayTasks,
      backlogTasks,
      unfinishedTasks: data.unfinishedTasks,
      projects: data.projects,
      projectById,
      activities: data.activities
    },
    {
      layoutMode,
      focusedMinutes: focus.snapshot?.today.focusedMinutes ?? 0,
      activeFocus: focus.active,
      focusNow: focus.now,
      focusBusy: focus.busy
    },
    dismissedUnfinished
  );
  const viewedDay = useViewedDay(
    data?.todayKey ?? "",
    data?.earliestDayKey ?? null,
    data?.dayViewForwardWeeks ?? null
  );
  const onDay = screen.startsWith("day-");

  // Leaving Log resets the day: one that persists across a detour through
  // Projects or Journal invites acting on the wrong day without noticing.
  useEffect(() => {
    if (!onDay) viewedDay.goToToday();
  }, [onDay, viewedDay.goToToday]);

  const dayIsToday = viewedDay.dayKey === (data?.todayKey ?? "");
  const dayTasks = dayIsToday
    ? openTodayTasks
    : ((viewedDay.payload?.tasks ?? []) as unknown as Task[]).filter(
        (task) => task.status !== "DONE"
      );
  const dayActivities = dayIsToday
    ? data?.activities ?? []
    : ((viewedDay.payload?.activities ?? []) as unknown as ActivityEntry[]);
  const dayTimeBlocks = dayIsToday
    ? data?.timeBlocks ?? []
    : ((viewedDay.payload?.timeBlocks ?? []) as unknown as TimeBlock[]);
  const dayBlockedMinutes = dayTimeBlocks
    .filter((block) => block.date === viewedDay.dayKey)
    .reduce((sum, block) => sum + safeTimeBlockDurationMinutes(block), 0);
  const dayRecordedMinutes = dayActivities.reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );

  const blockedMinutes = (data?.timeBlocks ?? [])
    .filter(
      (block) => block.date === data?.todayKey
    )
    .reduce(
      (sum, block) => sum + safeTimeBlockDurationMinutes(block),
      0
    );
  const activityMinutes = (data?.activities ?? []).reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );
  const paletteResolution = useMemo(
    () =>
      resolvePalette({
        query: paletteQuery,
        tasks: (data?.paletteTasks ?? []).map(({ id, title }) => ({ id, title })),
        projects: (data?.projects ?? [])
          .filter((project) => project.status === "ACTIVE")
          .map(({ id, name }) => ({ id, name })),
        hasActiveFocus: Boolean(focus.active ?? focus.pendingCompletion),
        activeFocusTaskId:
          focus.active?.taskId ?? focus.pendingCompletion?.taskId ?? null
      }),
    [
      data?.paletteTasks,
      data?.projects,
      focus.active,
      focus.pendingCompletion,
      paletteQuery
    ]
  );

  function openCommandPalette() {
    if (
      document.querySelector<HTMLElement>(
        '[role="dialog"][aria-modal="true"]'
      )
    ) {
      return;
    }
    paletteOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setMobileMoreOpen(false);
    setPaletteQuery("");
    setPaletteOpen(true);
  }

  function dismissCommandPalette() {
    const opener = paletteOpener.current;
    closeCommandPaletteForHandoff();
    window.setTimeout(() => {
      if (opener?.isConnected) opener.focus();
    }, 0);
  }

  function closeCommandPaletteForHandoff() {
    setPaletteOpen(false);
    setPaletteQuery("");
    paletteOpener.current = null;
  }

  function focusTaskDraft() {
    window.setTimeout(() => {
      const input =
        document.getElementById("new-task") ??
        document.getElementById("first-task");
      input?.focus();
    }, 0);
  }

  function applyPaletteDraft(
    value: string | null,
    setDraft: (value: string) => void
  ) {
    if (value !== null) setDraft(value);
  }

  function preparePaletteFocus(target: FocusTarget) {
    setFocusDraft({ ...target, revision: Date.now() });
    setRailExpanded(true);
  }


  function activatePaletteItem(item: PaletteItem) {
    closeCommandPaletteForHandoff();

    switch (item.intent.kind) {
      case "show-focus":
        setRailExpanded(true);
        return;
      case "start-focus":
        preparePaletteFocus({ plannedMinutes: item.intent.plannedMinutes });
        return;
      case "focus-task": {
        const { taskId } = item.intent;
        const task = data?.paletteTasks.find(
          (candidate) => candidate.id === taskId
        );
        if (!task) return;
        preparePaletteFocus({
          taskId: task.id,
          label: task.title,
          plannedMinutes: task.estimateMinutes || 25
        });
        return;
      }
      case "queue-task": {
        const { taskId } = item.intent;
        const task = data?.paletteTasks.find(
          (candidate) => candidate.id === taskId
        );
        if (task) void queueTask(task, "end");
        return;
      }
      case "draft-task":
        applyPaletteDraft(item.intent.title, setNewTask);
        navigate("today");
        focusTaskDraft();
        return;
      case "draft-activity":
        activity.openCreate();
        return;
      case "draft-note":
        applyPaletteDraft(item.intent.content, (content) =>
          setNoteDraft((current) => ({ ...current, content }))
        );
        navigate("journal");
        journal.setView("notes");
        window.setTimeout(
          () => document.getElementById("new-note")?.focus(),
          0
        );
        return;
      case "draft-reference":
        applyPaletteDraft(item.intent.url, (url) =>
          setMaterialDraft((current) => ({ ...current, url }))
        );
        navigate("journal");
        journal.setView("references");
        window.setTimeout(
          () => document.getElementById("material-url")?.focus(),
          0
        );
        return;
      case "open-project":
        openProject(item.intent.projectId);
        return;
    }
  }

  function navigate(next: Screen) {
    setScreen(next);
    setRailExpanded(false);
    closeCommandPaletteForHandoff();
    setMobileMoreOpen(false);
    if (next !== "projects") setSelectedProjectId(null);
  }

  function openFirstProject() {
    setSelectedProjectId(null);
    setProjectCreateOpen(true);
    navigate("projects");
  }

  function openFocus(target: FocusTarget) {
    if (compactLayout && target.plannedMinutes) {
      closeCommandPaletteForHandoff();
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
    closeCommandPaletteForHandoff();
    if (screen !== "today") setRailExpanded(true);
  }

  function openProject(id: string) {
    setSelectedProjectId(id);
    setScreen("projects");
    setRailExpanded(false);
    closeCommandPaletteForHandoff();
  }

  function openProjectBacklog(id: string) {
    backlog.setArrangement("project");
    backlog.setScopeProjectId(id);
    navigate("backlog");
  }

  async function addTask(date: string | null = data?.todayKey ?? null) {
    const title = newTask.trim();
    if (!title || taskCreatePending) return false;
    const payload = { title, date, estimateMinutes: 30 };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    setTaskCreatePending(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isTaskResponse(result) ||
        result.title !== payload.title
      ) {
        const message =
          result && typeof result.error === "string"
            ? result.error
            : "Your task was not saved. Your draft is still here.";
        setAppError(message);
        setAppAnnouncement("Task was not saved.");
        taskCreateWasInError.current = true;
        return false;
      }
      setNewTask((current) => (current.trim() === title ? "" : current));
      taskCreateMutation.current = null;
      setAppError("");
      if (taskCreateWasInError.current) {
        taskCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Your task was not saved. Your draft is still here.");
      setAppAnnouncement("Task was not saved.");
      taskCreateWasInError.current = true;
      return false;
    } finally {
      setTaskCreatePending(false);
    }
  }

  async function beginFirstRun(title: string, startFocus: boolean) {
    const trimmed = title.trim();
    if (!trimmed || !data || taskCreatePending) return;
    const payload = {
      title: trimmed,
      date: data.todayKey,
      estimateMinutes: 25
    };
    const mutationId = mutationIdFor(taskCreateMutation, payload);
    setTaskCreatePending(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isTaskResponse(result) ||
        result.title !== payload.title
      ) {
        setAppError(
          result && typeof result.error === "string"
            ? result.error
            : "Your first task was not saved. Your draft is still here."
        );
        taskCreateWasInError.current = true;
        return;
      }
      window.localStorage.setItem("dayflow-first-run-seen", "1");
      taskCreateMutation.current = null;
      setNewTask((current) => (current.trim() === trimmed ? "" : current));
      setFirstRunSeen(true);
      setAppError("");
      if (taskCreateWasInError.current) {
        taskCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
      if (startFocus) {
        openFocus({
          taskId: result.id,
          label: result.title,
          plannedMinutes: DEFAULT_FOCUS_MINUTES
        });
      }
    } catch {
      setAppError("Your first task was not saved. Your draft is still here.");
      taskCreateWasInError.current = true;
    } finally {
      setTaskCreatePending(false);
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
      const result = await response.json().catch(() => null);
      if (!response.ok || !isTaskResponse(result) || result.id !== id) {
        return false;
      }
      await refreshAfterConfirmedMutation();
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
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        result.ok !== true
      ) {
        setAppError(
          result && typeof result.error === "string"
            ? result.error
            : "Task could not be deleted."
        );
        return;
      }
      setAppError("");
      await refreshAfterConfirmedMutation();
    } catch {
      setAppError("Task could not be deleted.");
    }
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
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isTaskReorderResponse(result) ||
        result.tasks.length !== reordered.length ||
        result.tasks.some((task, index) => task.id !== reordered[index]?.id)
      ) {
        throw new Error("Order could not be saved.");
      }
      setAppError("");
      if (announce) {
        setAppAnnouncement(
          describeTaskMove(item.title, newIndex, reordered.length)
        );
      }
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Couldn’t save the new order. Retry the move.");
      setAppAnnouncement("The new task order was not saved.");
      await refresh().catch(() => undefined);
      return false;
    }
  }

  async function queueTask(
    task: Pick<Task, "id" | "title">,
    placement: QueuePlacement
  ) {
    try {
      const response = await fetch("/api/focus-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, placement })
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isFocusQueueResponse(result) ||
        !result.tasks.some(
          (queuedTask) =>
            queuedTask.id === task.id &&
            queuedTask.focusQueuePosition !== null
        )
      ) {
        throw new Error("The queue could not be saved.");
      }
      setAppError("");
      setAppAnnouncement(
        placement === "next"
          ? `${task.title}, queued next.`
          : `${task.title}, added to the queue.`
      );
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      setAppError("Couldn’t save the focus queue. Try that action again.");
      setAppAnnouncement("The focus queue was not saved.");
      return false;
    }
  }

  async function removeQueuedTask(task: Pick<Task, "id" | "title">) {
    try {
      const response = await fetch("/api/focus-queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isFocusQueueResponse(result) ||
        result.tasks.some((queuedTask) => queuedTask.id === task.id)
      ) {
        throw new Error("The queue could not be saved.");
      }
      setAppError("");
      setAppAnnouncement(`${task.title}, removed from the queue.`);
      await refreshAfterConfirmedMutation();
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
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isFocusQueueResponse(result) ||
        result.tasks.some((task, index) => task.id !== ids[index]) ||
        result.tasks.length !== ids.length
      ) {
        throw new Error("The queue could not be saved.");
      }
      setAppError("");
      setAppAnnouncement(announcement);
      await refreshAfterConfirmedMutation();
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
      await refresh().catch(() => undefined);
      return false;
    }
  }

  function selectNoteTask(taskId: string) {
    setNoteDraft((current) => ({
      ...current,
      taskId,
      projectId: taskProjectIdFor(taskId, journal.tasks)
        ? ""
        : current.projectId
    }));
  }

  function selectMaterialTask(taskId: string) {
    setMaterialDraft((current) => ({
      ...current,
      taskId,
      projectId: taskProjectIdFor(taskId, journal.tasks)
        ? ""
        : current.projectId
    }));
  }

  async function addNote() {
    if (!noteDraft.content.trim() || noteSaving) return;
    let tags: string[];
    try {
      tags = normalizeNoteTags(
        noteDraft.tags.split(",").map((tag) => tag.trim())
      );
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Note tags are invalid."
      );
      noteCreateWasInError.current = true;
      setAppAnnouncement("The note was not saved.");
      return;
    }
    const selectedTaskProjectId = taskProjectIdFor(
      noteDraft.taskId,
      journal.tasks
    );
    const expectedProjectId = selectedTaskProjectId
      ? null
      : noteDraft.projectId || null;
    const payload = {
      content: noteDraft.content.trim(),
      tags,
      taskId: noteDraft.taskId || null,
      projectId: noteDraft.projectId || null
    };
    const mutationId = mutationIdFor(noteCreateMutation, payload);
    setNoteSaving(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isNoteResponse(result) ||
        result.content !== payload.content ||
        !stringArraysEqual(result.tags, payload.tags) ||
        result.taskId !== payload.taskId ||
        result.projectId !== expectedProjectId ||
        !data?.todayKey ||
        localDateKey(new Date(result.date)) !== data.todayKey
      ) {
        setAppError(
          result && typeof result.error === "string"
            ? result.error
            : "The note could not be saved. Your draft is still here."
        );
        noteCreateWasInError.current = true;
        return;
      }
      setNoteDraft(emptyNoteCaptureDraft);
      noteCreateMutation.current = null;
      journal.noteHistory.refresh();
      journal.noteOptionHistory.refresh();
      setAppError("");
      if (noteCreateWasInError.current) {
        noteCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch {
      setAppError("The note could not be saved. Your draft is still here.");
      noteCreateWasInError.current = true;
    } finally {
      setNoteSaving(false);
    }
  }

  async function addMaterial() {
    if (!materialDraft.url.trim() || materialSaving) return;
    const selectedTaskProjectId = taskProjectIdFor(
      materialDraft.taskId,
      journal.tasks
    );
    const expectedProjectId = selectedTaskProjectId
      ? null
      : materialDraft.projectId || null;
    const payload = {
      title: materialDraft.title.trim(),
      url: materialDraft.url.trim(),
      notes: materialDraft.notes.trim(),
      taskId: materialDraft.taskId || null,
      noteId: materialDraft.noteId || null,
      projectId: materialDraft.projectId || null
    };
    const mutationId = mutationIdFor(materialCreateMutation, payload);
    setMaterialSaving(true);
    try {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": mutationId
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isMaterialResponse(result) ||
        result.url !== payload.url ||
        result.title !==
          (payload.title ||
            inferMaterialTitle(inferMaterialType(payload.url))) ||
        result.type !== inferMaterialType(payload.url) ||
        result.notes !== payload.notes ||
        result.taskId !== payload.taskId ||
        result.noteId !== payload.noteId ||
        result.projectId !== expectedProjectId
      ) {
        setAppError(
          result && typeof result.error === "string"
            ? result.error
            : "The reference could not be saved. Your draft is still here."
        );
        materialCreateWasInError.current = true;
        return;
      }
      setMaterialDraft(emptyMaterialCaptureDraft);
      materialCreateMutation.current = null;
      journal.materialHistory.refresh();
      setAppError("");
      if (materialCreateWasInError.current) {
        materialCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch {
      setAppError(
        "The reference could not be saved. Your draft is still here."
      );
      materialCreateWasInError.current = true;
    } finally {
      setMaterialSaving(false);
    }
  }

  async function saveDiary(diary: Diary) {
    try {
      const response = await fetch("/api/diary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diary)
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isPersistedDiaryResponse(result) ||
        result.date !== diary.date ||
        result.content !== diary.content ||
        result.reflection !== diary.reflection ||
        result.mood !== diary.mood ||
        result.energy !== diary.energy
      ) {
        return false;
      }
      await refreshAfterConfirmedMutation();
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

  async function saveReview(review: Review) {
    const payload = {
      periodStart: review.periodStart,
      periodEnd: review.periodEnd,
      narrative: review.narrative.trim(),
      nextPeriodIntention: review.nextPeriodIntention.trim()
    };
    try {
      const response = await fetch("/api/review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (
        response.status === 409 &&
        result &&
        typeof result === "object" &&
        (result as { code?: unknown }).code === "REVIEW_PERIOD_CHANGED"
      ) {
        try {
          await refresh();
          setAppAnnouncement(
            "The Review Period changed. A fresh Review is ready."
          );
          setAppError("");
          return true;
        } catch {
          setAppError(
            "The Review Period changed, but Dayflow could not load it. Reload to continue."
          );
          setAppAnnouncement("The new Review Period could not be loaded.");
          return false;
        }
      }
      if (
        !response.ok ||
        !isPersistedReviewResponse(result) ||
        result.periodStart !== payload.periodStart ||
        result.periodEnd !== payload.periodEnd ||
        result.narrative !== payload.narrative ||
        result.nextPeriodIntention !== payload.nextPeriodIntention
      ) {
        return false;
      }
      setData((current) =>
        current ? { ...current, review: result } : current
      );
      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      return false;
    }
  }

  function reportReviewSaveFailure() {
    reviewSaveWasInError.current = true;
    setAppAnnouncement("Review was not saved.");
    setAppError(
      "Couldn’t save the review. Your writing is still here — retry."
    );
  }

  function reportReviewSaveRecovery() {
    if (!reviewSaveWasInError.current) return;
    reviewSaveWasInError.current = false;
    setAppAnnouncement("Saved.");
    setAppError("");
  }


  function defaultTimeBlockTimes(durationMinutes: number) {
    const now = new Date();
    const duration = Math.min(
      TIME_BLOCK_LAST_MINUTE,
      Math.max(1, Math.trunc(durationMinutes))
    );
    const preferred =
      Math.ceil(
        (now.getHours() * 60 + now.getMinutes()) /
          TIME_BLOCK_SLOT_INTERVAL_MINUTES
      ) * TIME_BLOCK_SLOT_INTERVAL_MINUTES;
    const latestStart = TIME_BLOCK_LAST_MINUTE - duration;
    const startMinutes =
      preferred <= latestStart
        ? preferred
        : Math.max(
            0,
            Math.floor(
              latestStart / TIME_BLOCK_SLOT_INTERVAL_MINUTES
            ) * TIME_BLOCK_SLOT_INTERVAL_MINUTES
          );
    return {
      startTime: minutesToTimeBlockTime(startMinutes),
      endTime: minutesToTimeBlockTime(startMinutes + duration)
    };
  }

  function openTimeBlockEditor(
    date: string,
    task: Task | null = null
  ) {
    if (!data) return;
    const durationMinutes = suggestedTaskBlockDuration(task);
    const slot = defaultTimeBlockTimes(durationMinutes);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor({
      id: null,
      date,
      originalTask: task
        ? {
            id: task.id,
            title: task.title,
            estimateMinutes: task.estimateMinutes
          }
        : null,
      linkedTask: task
        ? {
            id: task.id,
            title: task.title,
            estimateMinutes: task.estimateMinutes
          }
        : null,
      draft: {
        title: task?.title ?? "",
        startTime: slot.startTime,
        endTime: slot.endTime,
        taskId: task?.id ?? ""
      }
    });
  }

  function editTimeBlock(block: TimeBlock) {
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor({
      id: block.id,
      date: block.date,
      originalTask: block.task,
      linkedTask: block.task,
      draft: {
        title: block.title,
        startTime: block.startTime,
        endTime: block.endTime,
        taskId: block.taskId ?? ""
      }
    });
  }

  function changeTimeBlockTask(taskId: string) {
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor((current) => {
      if (!current) return current;
      const task =
        timeBlockTaskCandidates.find((item) => item.id === taskId) ??
        (current.linkedTask?.id === taskId
          ? current.linkedTask
          : current.originalTask?.id === taskId
            ? current.originalTask
            : null);
      if (!task) {
        return {
          ...current,
          draft: { ...current.draft, taskId: "" }
        };
      }
      const slot =
        current.id === null
          ? defaultTimeBlockTimes(suggestedTaskBlockDuration(task))
          : {
              startTime: current.draft.startTime,
              endTime: current.draft.endTime
            };
      return {
        ...current,
        linkedTask: {
          id: task.id,
          title: task.title,
          estimateMinutes: task.estimateMinutes
        },
        draft: {
          title: task.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          taskId: task.id
        }
      };
    });
  }

  async function saveTimeBlock() {
    if (!data || !timeBlockEditor || timeBlockSaving) return;
    const payload = {
      date: timeBlockEditor.date,
      title: timeBlockEditor.draft.title,
      startTime: timeBlockEditor.draft.startTime,
      endTime: timeBlockEditor.draft.endTime,
      taskId: timeBlockEditor.draft.taskId || null
    };
    const creating = timeBlockEditor.id === null;
    const mutationId = creating
      ? mutationIdFor(timeBlockCreateMutation, payload)
      : null;
    setTimeBlockSaving(true);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    try {
      const response = await fetch(
        creating
          ? "/api/time-blocks"
          : `/api/time-blocks/${timeBlockEditor.id}`,
        {
          method: creating ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(mutationId
              ? { "X-Dayflow-Mutation-Id": mutationId }
              : {})
          },
          body: JSON.stringify(payload)
        }
      );
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isTimeBlockRecord(result) ||
        (!creating && result.id !== timeBlockEditor.id) ||
        result.title !== payload.title.trim() ||
        result.startTime !== payload.startTime ||
        result.endTime !== payload.endTime ||
        result.taskId !== payload.taskId ||
        result.date !== payload.date
      ) {
        setTimeBlockError(
          result && typeof result.error === "string"
            ? result.error
            : "Time block could not be saved. Your draft is still here."
        );
        setTimeBlockErrorField(timeBlockErrorFieldFrom(result));
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              timeBlocks: creating
                ? [...current.timeBlocks, result]
                : current.timeBlocks.map((block) =>
                    block.id === result.id ? result : block
                  )
            }
          : current
      );
      if (creating) timeBlockCreateMutation.current = null;
      setTimeBlockError("");
      setTimeBlockErrorField(null);
      setAppError("");
      setAppAnnouncement(
        creating ? "Time block added." : "Time block updated."
      );
      const refreshed = await refreshAfterConfirmedMutation();
      const viewedDayRefreshed =
        payload.date === data.todayKey
          ? true
          : await viewedDay.setDay(payload.date);
      if (!refreshed || !viewedDayRefreshed) {
        setTimeBlockEditor((current) =>
          current
            ? {
                id: result.id,
                date: current.date,
                originalTask: result.task,
                linkedTask: result.task,
                draft: current.draft
              }
            : current
        );
        setTimeBlockError(
          "This Time Block was saved, but the latest view could not be refreshed. Your values are still here; reload to try again."
        );
        setTimeBlockErrorField(null);
        return;
      }
      setTimeBlockEditor(null);
    } catch {
      setTimeBlockError(
        "Time block could not be saved. Your draft is still here."
      );
      setTimeBlockErrorField(null);
    } finally {
      setTimeBlockSaving(false);
    }
  }

  async function deleteTimeBlock() {
    if (!timeBlockEditor?.id || timeBlockSaving) return;
    const id = timeBlockEditor.id;
    setTimeBlockSaving(true);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    try {
      const response = await fetch(`/api/time-blocks/${id}`, {
        method: "DELETE"
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        result.ok !== true ||
        result.id !== id
      ) {
        setTimeBlockError(
          result && typeof result.error === "string"
            ? result.error
            : "Time block could not be deleted. Try again."
        );
        setTimeBlockErrorField(null);
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              timeBlocks: current.timeBlocks.filter(
                (block) => block.id !== id
              )
            }
          : current
      );
      setTimeBlockEditor(null);
      setTimeBlockErrorField(null);
      setAppError("");
      setAppAnnouncement("Time block deleted.");
      await refreshAfterConfirmedMutation();
    } catch {
      setTimeBlockError("Time block could not be deleted. Try again.");
      setTimeBlockErrorField(null);
    } finally {
      setTimeBlockSaving(false);
    }
  }

  if (!data && bootstrapFailure) {
    const migrationRequired =
      bootstrapFailure.code === "DATABASE_MIGRATION_REQUIRED";
    return (
      <main className="startup-error-screen">
        <section className="startup-error-card" role="alert">
          <span className="eyebrow">Local data</span>
          <h1>
            {migrationRequired
              ? "Update Dayflow's local database"
              : "Dayflow could not open"}
          </h1>
          {migrationRequired ? (
            <>
              <p>
                Your data is still in place, but this version of Dayflow needs
                the latest checked-in database migrations.
              </p>
              <code>npm run db:migrate</code>
              <p className="startup-error-note">
                Stop Dayflow before running the command, then start it again.
              </p>
            </>
          ) : (
            <p>{bootstrapFailure.message}</p>
          )}
          <button
            className="primary-button"
            onClick={() => void retryBootstrap()}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Try again
          </button>
        </section>
      </main>
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

  const timeBlockTaskCandidates =
    timeBlockEditor &&
    !dayIsToday &&
    timeBlockEditor.date === viewedDay.dayKey
      ? dayTasks
      : openTodayTasks;
  const timeBlockDialogTasks = mergeTimeBlockTaskOptions(
    timeBlockTaskCandidates,
    timeBlockEditor
  );
  const isToday = screen === "today";
  const liveFocus = focus.active ?? focus.pendingCompletion;
  const showFullRail =
    Boolean(focus.retryNext) ||
    (compactLayout && railExpanded && Boolean(liveFocus || focusDraft)) ||
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
    data.workspaceEmpty;

  return (
    <main className="app-shell focus-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <strong>Dayflow</strong>
        </div>
        <button className="search-trigger" onClick={openCommandPalette}>
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
              setFocusDraft({ revision: Date.now(), plannedMinutes: DEFAULT_FOCUS_MINUTES });
              setRailExpanded(true);
            }}
          >
            <Play size={14} />
            Start focus
            <kbd>⌘⇧F</kbd>
          </button>
        )}
        <button
          className="sidebar-data-button"
          aria-label="Data & backups"
          onClick={() => setDataManagementOpen(true)}
        >
          <DatabaseBackup size={15} />
          <span>Data &amp; backups</span>
        </button>
        <footer className="sidebar-focus-summary">
          <span className="eyebrow">Today&apos;s focus</span>
          <strong>{formatMinutes(focusedMinutes)}</strong>
          <div className="focus-pips" aria-label={`${completedSessions} of 4 focus sessions`}>
            {[0, 1, 2, 3].map((index) => (
              <i key={index} className={index < completedSessions ? "filled" : ""} />
            ))}
          </div>
          <small>{completedSessions} of 4 focus sessions</small>
        </footer>
      </aside>

      <section className="workspace">
        <button
          className="mobile-capture-button"
          aria-label="Search or add"
          onClick={openCommandPalette}
        >
          <Plus size={19} />
          <span>Capture</span>
        </button>
        {screen === "today" && firstRun && (
          <FirstRunPage
            today={data.today}
            title={newTask}
            saving={taskCreatePending}
            onTitleChange={setNewTask}
            onBegin={beginFirstRun}
            onCreateProject={openFirstProject}
            onOpenCapture={openCommandPalette}
          />
        )}
        {screen === "today" && !firstRun && today.page && (
          <TodayPage
            {...today.page}
            onFocusTransition={focus.transition}
            onAddTask={addTask}
            newTask={newTask}
            taskCreatePending={taskCreatePending}
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
          />
        )}

        {screen.startsWith("day-") && (
          <DayPage
            view={screen.replace("day-", "") as DayView}
            today={data.today}
            todayKey={data.todayKey}
            dayKey={viewedDay.dayKey}
            dayKind={viewedDay.kind}
            earliestDayKey={viewedDay.earliestDayKey}
            forwardWeeks={
              viewedDay.forwardWeeks ?? data.dayViewForwardWeeks
            }
            dayLoading={viewedDay.loading}
            dayError={viewedDay.error}
            onChangeDay={(next) => {
              void viewedDay.setDay(next);
              // A future day opens on Timeline: Stream is built around
              // recorded Activity that such a day cannot have.
              if (next > (data?.todayKey ?? "")) navigate("day-timeline");
            }}
            onGoToToday={viewedDay.goToToday}
            tasks={dayTasks}
            activities={dayActivities}
            timeBlocks={dayTimeBlocks}
            projects={projectById}
            blockedMinutes={dayBlockedMinutes}
            recordedMinutes={dayRecordedMinutes}
            noteCount={data.notes.length}
            activeFocus={focus.active}
            focusNow={focus.now}
            focusBusy={focus.busy}
            onViewChange={(view) => navigate(`day-${view}`)}
            onStartFocus={openFocus}
            onQueueTask={queueTask}
            onFocusTransition={focus.transition}
            onOpenPalette={openCommandPalette}
            onCreateTimeBlock={openTimeBlockEditor}
            onEditTimeBlock={editTimeBlock}
            onEditActivity={activity.openEdit}
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

        {screen === "backlog" && backlog.page && (
          <BacklogPage
            {...backlog.page}
            onOpenProject={openProject}
            activeTaskId={focus.active?.taskId ?? null}
            onStartFocus={openFocus}
            onUpdateTask={updateTask}
            onOpenPalette={openCommandPalette}
          />
        )}

        {screen === "journal" && journal.page && (
          <JournalPage
            {...journal.page}
            onDiaryChange={setDiaryValue}
            onSaveDiary={saveDiary}
            onSaveError={reportDiarySaveFailure}
            onSaveRecovered={reportDiarySaveRecovery}
            noteDraft={noteDraft}
            noteSaving={noteSaving}
            onNoteDraftChange={(field, value) =>
              setNoteDraft((current) => ({ ...current, [field]: value }))
            }
            onNoteTaskChange={selectNoteTask}
            onAddNote={addNote}
            materialDraft={materialDraft}
            materialSaving={materialSaving}
            onMaterialDraftChange={(field, value) =>
              setMaterialDraft((current) => ({ ...current, [field]: value }))
            }
            onMaterialTaskChange={selectMaterialTask}
            onAddMaterial={addMaterial}
          />
        )}

        {screen === "review" && (
          <ReviewPage
            projects={data.projects}
            review={data.review}
            summary={data.reviewSummary}
            onSaveReview={saveReview}
            onSaveError={reportReviewSaveFailure}
            onSaveRecovered={reportReviewSaveRecovery}
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
          <button
            role="menuitem"
            onClick={() => {
              setMobileMoreOpen(false);
              setDataManagementOpen(true);
            }}
          >
            <DatabaseBackup size={17} />
            Data &amp; backups
          </button>
        </div>
      )}

      {phoneLayout && railExpanded && (liveFocus || focusDraft) && (
        <button
          className="focus-sheet-backdrop"
          aria-label="Close focus sheet"
          onClick={() => setRailExpanded(false)}
        />
      )}
      {showFullRail && (
        <FocusRail
          tasks={data.paletteTasks}
          projects={data.projects}
          today={data.today}
          draft={focusDraft}
          activities={data.activities}
          queuedTasks={queuedTasks}
          mode="full"
          collapsible={
            !focus.retryNext &&
            (compactLayout || (!isToday && !wideFocusRail))
          }
          onCollapse={() => setRailExpanded(false)}
          onOpenPalette={openCommandPalette}
          onQueueTask={(taskId, placement) => {
            const task = data.paletteTasks.find((item) => item.id === taskId);
            return task ? queueTask(task, placement) : Promise.resolve(false);
          }}
          onRemoveQueuedTask={(taskId) => {
            const task = data.paletteTasks.find((item) => item.id === taskId);
            return task ? removeQueuedTask(task) : Promise.resolve(false);
          }}
          onReorderQueue={reorderQueue}
          onQueueChanged={refresh}
          onAnnounce={setAppAnnouncement}
        />
      )}
      {showStrip && (
        <FocusRail
          tasks={data.paletteTasks}
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
          resolution={paletteResolution}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          onActivate={activatePaletteItem}
          onDismiss={dismissCommandPalette}
        />
      )}

      {timeBlockEditor && (
        <TimeBlockDialog
          mode={timeBlockEditor.id === null ? "create" : "edit"}
          dateLabel={formatLongLocalDateKey(timeBlockEditor.date)}
          draft={timeBlockEditor.draft}
          tasks={timeBlockDialogTasks}
          saving={timeBlockSaving}
          error={timeBlockError}
          errorField={timeBlockErrorField}
          onDraftChange={(draft) => {
            setTimeBlockEditor((current) =>
              current ? { ...current, draft } : current
            );
            setTimeBlockError("");
            setTimeBlockErrorField(null);
          }}
          onTaskChange={changeTimeBlockTask}
          onClose={() => {
            setTimeBlockEditor(null);
            setTimeBlockError("");
            setTimeBlockErrorField(null);
          }}
          onSave={saveTimeBlock}
          onDelete={
            timeBlockEditor.id === null ? undefined : deleteTimeBlock
          }
        />
      )}

      {activity.open && (
        <ActivityDialog
          mode={activity.editor ? "edit" : "create"}
          tasks={activity.dialogTasks}
          projects={data.projects}
          todayKey={data.todayKey}
          categorySuggestions={data.activityCategorySuggestions}
          draft={activity.draft}
          originalTaskId={activity.editor?.original.taskId ?? null}
          originalInheritedProjectId={
            activity.editor?.original.taskId &&
            activity.editor.original.projectId === null
              ? activity.editor.original.attributedProjectId
              : null
          }
          error={activity.error}
          saving={activity.saving}
          onDraftChange={activity.changeDraft}
          onClose={activity.close}
          onSave={activity.save}
        />
      )}
      {dataManagementOpen && (
        <DataManagementDialog
          onClose={() => setDataManagementOpen(false)}
          onAnnounce={setAppAnnouncement}
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

function ActivityDialog({
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

function suggestedTaskBlockDuration(
  task: Pick<Task, "estimateMinutes"> | null
) {
  const estimate = task?.estimateMinutes ?? 60;
  return Math.min(
    TIME_BLOCK_LAST_MINUTE,
    Math.max(1, estimate || 30)
  );
}

function taskDateLocalKey(value: string | null) {
  if (!value) return null;
  const date = parseLocalDate(value);
  return date ? localDateKey(date) : null;
}

function mergeTimeBlockTaskOptions(
  tasks: TimeBlockTaskSummary[],
  editor: TimeBlockEditor | null
) {
  const result = [...tasks];
  for (const task of [editor?.originalTask, editor?.linkedTask]) {
    if (task && !result.some((candidate) => candidate.id === task.id)) {
      result.push(task);
    }
  }
  return result;
}
