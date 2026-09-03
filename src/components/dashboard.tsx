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
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  DatabaseBackup,
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
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { DataManagementDialog } from "@/components/data-management-dialog";
import { DayPage } from "@/components/day-workspace";
import { safeTimeBlockDurationMinutes } from "@/components/day-workspace-helpers";
import {
  formatLongDate,
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
import { FocusDraft, FocusRail } from "@/components/focus-timer";
import { useFocusSession } from "@/components/focus-session-provider";
import { SaveStateChip, useSaveState } from "@/components/save-state";
import {
  MiniFocusRing,
  PageHeader,
  SegmentedControl
} from "@/components/workspace-ui";
import { useViewedDay } from "@/components/use-viewed-day";
import {
  useJournalEvidenceHistory,
  type JournalHistoryResult,
  type JournalHistoryState,
  type NoteHistoryCriteria,
  type ReferenceHistoryCriteria
} from "@/components/use-journal-evidence-history";
import {
  TimeBlockDialog,
  type TimeBlockEditorDraft,
  type TimeBlockErrorField
} from "@/components/time-block-dialog";
import {
  LayoutMode,
  markDocumentResizing,
  useLayoutMode
} from "@/components/use-layout-mode";
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
  JOURNAL_SEARCH_MAX_LENGTH,
  NOTE_TAG_MAX_LENGTH,
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
type TimeBlockEditor = {
  id: string | null;
  date: string;
  originalTask: TimeBlockTaskSummary | null;
  linkedTask: TimeBlockTaskSummary | null;
  draft: TimeBlockEditorDraft;
};
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
type JournalTaskOption = Pick<Task, "id" | "title" | "projectId">;

type Note = JournalNoteRecord;

type Diary = {
  id: string | null;
  date: string;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
  persisted: boolean;
};

type Review = {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  nextPeriodIntention: string;
  persisted: boolean;
};

type Material = JournalMaterialRecord;

type NoteCaptureDraft = {
  content: string;
  tags: string;
  taskId: string;
  projectId: string;
};

type MaterialCaptureDraft = {
  title: string;
  url: string;
  notes: string;
  taskId: string;
  noteId: string;
  projectId: string;
};

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

function describeTaskMove(title: string, position: number, total: number) {
  const edge =
    position === 0 ? " Now first." : position === total - 1 ? " Now last." : "";
  return `Moved "${title}" to position ${position + 1} of ${total}.${edge}`;
}

function diariesEqual(left: Diary, right: Diary) {
  return (
    left.id === right.id &&
    left.persisted === right.persisted &&
    left.date === right.date &&
    left.content === right.content &&
    left.reflection === right.reflection &&
    left.mood === right.mood &&
    left.energy === right.energy
  );
}

function stringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function taskProjectIdFor(
  taskId: string,
  tasks: JournalTaskOption[]
): string | null {
  return tasks.find(({ id }) => id === taskId)?.projectId ?? null;
}

function mergeJournalRecords<T extends { id: string; createdAt: string }>(
  ...collections: T[][]
) {
  const byId = new Map<string, T>();
  for (const item of collections.flat()) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id)
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
  const [journalView, setJournalView] = useState<JournalView>("daily");
  const noteHistory = useJournalEvidenceHistory(
    "note",
    screen === "journal" && journalView === "notes"
  );
  const materialHistory = useJournalEvidenceHistory(
    "material",
    screen === "journal" && journalView === "references"
  );
  const noteOptionHistory = useJournalEvidenceHistory(
    "note",
    screen === "journal" && journalView === "references"
  );
  const [backlogArrange, setBacklogArrange] =
    useState<BacklogArrange>("quadrant");
  const [backlogScopeProjectId, setBacklogScopeProjectId] = useState<string | null>(
    null
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
    if (!figureArrangement) {
      setBacklogArrange((current) =>
        current === "figure" ? "quadrant" : current
      );
    }
  }, [figureArrangement]);

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
  const journalTaskOptions = useMemo(() => {
    const byId = new Map<string, JournalTaskOption>();
    for (const task of [...(data?.paletteTasks ?? []), ...(data?.tasks ?? [])]) {
      byId.set(task.id, {
        id: task.id,
        title: task.title,
        projectId: task.projectId
      });
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.title.localeCompare(right.title, undefined, {
          sensitivity: "base"
        }) || left.id.localeCompare(right.id)
    );
  }, [data?.paletteTasks, data?.tasks]);
  const journalNoteOptions = useMemo(
    () =>
      mergeJournalRecords(noteOptionHistory.items, data?.notes ?? []),
    [data?.notes, noteOptionHistory.items]
  );
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
        setJournalView("notes");
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
        setJournalView("references");
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
    setBacklogArrange("project");
    setBacklogScopeProjectId(id);
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
      projectId: taskProjectIdFor(taskId, journalTaskOptions)
        ? ""
        : current.projectId
    }));
  }

  function selectMaterialTask(taskId: string) {
    setMaterialDraft((current) => ({
      ...current,
      taskId,
      projectId: taskProjectIdFor(taskId, journalTaskOptions)
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
      journalTaskOptions
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
      noteHistory.refresh();
      noteOptionHistory.refresh();
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
      journalTaskOptions
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
      materialHistory.refresh();
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
            activities={data.activities}
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
            onOpenPalette={openCommandPalette}
          />
        )}

        {screen === "journal" && (
          <JournalPage
            today={data.today}
            view={journalView}
            onViewChange={setJournalView}
            diary={data.diary}
            notes={journalView === "notes" ? noteHistory.items : data.notes}
            materials={
              journalView === "references" ? materialHistory.items : data.materials
            }
            noteHistory={noteHistory}
            materialHistory={materialHistory}
            noteOptionHistory={noteOptionHistory}
            tasks={journalTaskOptions}
            noteOptions={journalNoteOptions}
            projects={projectById}
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
  taskCreatePending,
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
  onAddTask: () => Promise<boolean>;
  newTask: string;
  taskCreatePending: boolean;
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
  // On a phone the day's own list is the page; Later stays folded away behind
  // it. But when nothing is scheduled at all, these backlog tasks are the only
  // useful content on the screen, so lead with them instead of hiding them.
  const [laterOpen, setLaterOpen] = useState(() => tasks.length === 0);
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
        title={todayHeadline(open.length, done.length)}
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
                  date: localDateKey(new Date(today)),
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
              if (event.key === "Enter" && !taskCreatePending) void onAddTask();
            }}
            placeholder="Add a task for today"
          />
          <button
            className="primary-button"
            disabled={taskCreatePending || !newTask.trim()}
            onClick={() => void onAddTask()}
          >
            <Plus size={15} />
            {taskCreatePending ? "Adding…" : "Add"}
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
              <span>Add one deliberate task when you are ready.</span>
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
                  date: localDateKey(new Date(today)),
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
  title,
  saving,
  onTitleChange,
  onBegin,
  onCreateProject,
  onOpenCapture
}: {
  today: string;
  title: string;
  saving: boolean;
  onTitleChange: (title: string) => void;
  onBegin: (title: string, startFocus: boolean) => Promise<void>;
  onCreateProject: () => void;
  onOpenCapture: () => void;
}) {
  return (
    <div className="first-run-page page-stack">
      <PageHeader eyebrow={formatLongDate(today)} title="Nothing here yet" />
      <p className="first-run-intro">
        Dayflow keeps one honest record of where your attention went. There is nothing
        to import and nothing to configure — the first block of focus is the whole setup.
      </p>
      <ol className="first-run-loop" aria-label="Dayflow workflow">
        <li>
          <strong>Decide</strong>
          <small>what matters</small>
        </li>
        <li>
          <strong>Plan</strong>
          <small>when to do it</small>
        </li>
        <li>
          <strong>Record</strong>
          <small>what happened</small>
        </li>
        <li>
          <strong>Capture</strong>
          <small>useful context</small>
        </li>
        <li>
          <strong>Review</strong>
          <small>evidence, choose next</small>
        </li>
      </ol>
      <section className="first-run-start">
        <span className="eyebrow focus-eyebrow">Start here</span>
        <label>
          What are you working on right now?
          <input
            id="first-task"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Name one thing"
          />
        </label>
        <div>
          <button
            type="button"
            className="primary-button"
            disabled={saving || !title.trim()}
            onClick={() => void onBegin(title, true)}
          >
            <Play size={15} />
            {saving ? "Saving…" : "Focus on it for 25m"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={saving || !title.trim()}
            onClick={() => void onBegin(title, false)}
          >
            Just add it to today
          </button>
        </div>
      </section>
      <section className="first-run-ready">
        <span className="eyebrow">When you are ready</span>
        <button
          type="button"
          disabled={saving}
          onClick={onCreateProject}
        >
          <Layers3 size={17} />
          <span>
            <strong>Group work under a project</strong>
            <small>Only worth it when something takes more than a few days.</small>
          </span>
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onOpenCapture}
        >
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
                date: localDateKey(new Date(today)),
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
  noteHistory,
  materialHistory,
  noteOptionHistory,
  tasks,
  noteOptions,
  projects,
  onDiaryChange,
  onSaveDiary,
  onSaveError,
  onSaveRecovered,
  noteDraft,
  noteSaving,
  onNoteDraftChange,
  onNoteTaskChange,
  onAddNote,
  materialDraft,
  materialSaving,
  onMaterialDraftChange,
  onMaterialTaskChange,
  onAddMaterial
}: {
  today: string;
  view: JournalView;
  onViewChange: (view: JournalView) => void;
  diary: Diary;
  notes: Note[];
  materials: Material[];
  noteHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  materialHistory: JournalHistoryResult<
    Material,
    ReferenceHistoryCriteria
  >;
  noteOptionHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  tasks: JournalTaskOption[];
  noteOptions: Note[];
  projects: Map<string, ProjectSummary>;
  onDiaryChange: <K extends keyof Diary>(key: K, value: Diary[K]) => void;
  onSaveDiary: (diary: Diary) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  noteDraft: NoteCaptureDraft;
  noteSaving: boolean;
  onNoteDraftChange: (
    field: Exclude<keyof NoteCaptureDraft, "taskId">,
    value: string
  ) => void;
  onNoteTaskChange: (value: string) => void;
  onAddNote: () => Promise<void>;
  materialDraft: MaterialCaptureDraft;
  materialSaving: boolean;
  onMaterialDraftChange: (
    field: Exclude<keyof MaterialCaptureDraft, "taskId">,
    value: string
  ) => void;
  onMaterialTaskChange: (value: string) => void;
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

  const noteTaskProjectId = taskProjectIdFor(noteDraft.taskId, tasks);
  const materialTaskProjectId = taskProjectIdFor(materialDraft.taskId, tasks);
  const noteFiltersActive = Boolean(
    noteHistory.criteria.q.trim() || noteHistory.criteria.tag.trim()
  );
  const referenceSearchActive = Boolean(
    materialHistory.criteria.q.trim()
  );

  return (
    <div className="journal-page page-stack">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title="Journal"
        actions={
          <SegmentedControl
            ariaLabel="Journal view"
            value={view}
            options={[
              ["daily", "Daily page"],
              [
                "notes",
                countedLabel(
                  "Notes",
                  noteHistory.totalCount ??
                    (view === "notes" ? notes.length : null)
                )
              ],
              [
                "references",
                countedLabel(
                  "References",
                  materialHistory.totalCount ??
                    (view === "references" ? materials.length : null)
                )
              ]
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
            <NoteCards
              notes={notes.slice(0, 2)}
              projects={projects}
              tasks={tasks}
            />
            <button className="rail-link" onClick={() => onViewChange("notes")}>
              New note<span className="desktop-shortcut"> · ⌘K</span>
            </button>
            <span className="eyebrow references-label">References</span>
            <ReferenceCards
              materials={materials.slice(0, 3)}
              projects={projects}
              tasks={tasks}
              notes={noteOptions}
            />
          </aside>
        </div>
      )}
      {view === "notes" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>New note</h2>
            <textarea
              id="new-note"
              value={noteDraft.content}
              disabled={noteSaving}
              onChange={(event) =>
                onNoteDraftChange("content", event.target.value)
              }
              placeholder="Capture a thought, decision, or reminder."
            />
            <input
              value={noteDraft.tags}
              disabled={noteSaving}
              onChange={(event) =>
                onNoteDraftChange("tags", event.target.value)
              }
              placeholder="Tags, comma separated"
            />
            <label>
              Linked task
              <select
                aria-label="Note linked task"
                value={noteDraft.taskId}
                disabled={noteSaving}
                onChange={(event) => onNoteTaskChange(event.target.value)}
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
                value={noteTaskProjectId ?? noteDraft.projectId}
                disabled={noteSaving || Boolean(noteTaskProjectId)}
                onChange={(event) =>
                  onNoteDraftChange("projectId", event.target.value)
                }
              >
                <option value="">No Project</option>
                {[...projects.values()].map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {noteTaskProjectId && <small>Inherited from linked task</small>}
            </label>
            <button
              className="primary-button"
              disabled={noteSaving || !noteDraft.content.trim()}
              onClick={() => void onAddNote()}
            >
              <Plus size={14} />
              {noteSaving ? "Saving…" : "Save note"}
            </button>
          </section>
          <section className="journal-history-results">
            <JournalSearchControls
              kind="note"
              text={noteHistory.criteria.q}
              tag={noteHistory.criteria.tag}
              loading={noteHistory.loading}
              onTextChange={(q) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  q
                })
              }
              onTagChange={(tag) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  tag
                })
              }
              onClear={() =>
                noteHistory.setCriteria({ q: "", tag: "" })
              }
            />
            <NoteCards
              notes={notes}
              projects={projects}
              tasks={tasks}
              onTagSelect={(tag) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  tag
                })
              }
              emptyCopy={
                noteHistory.loading || noteHistory.error
                  ? ""
                  : noteFiltersActive
                    ? "No notes match these filters."
                    : "No notes saved yet."
              }
            />
            <HistoryFooter
              noun="notes"
              state={noteHistory}
              onLoadMore={noteHistory.loadNext}
              onRetry={noteHistory.retry}
            />
          </section>
        </div>
      )}
      {view === "references" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>Save reference</h2>
            <input
              value={materialDraft.title}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("title", event.target.value)
              }
              placeholder="Title"
            />
            <input
              id="material-url"
              value={materialDraft.url}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("url", event.target.value)
              }
              placeholder="URL"
            />
            <textarea
              value={materialDraft.notes}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("notes", event.target.value)
              }
              placeholder="Why this matters"
            />
            <label>
              Linked task
              <select
                aria-label="Reference linked task"
                value={materialDraft.taskId}
                disabled={materialSaving}
                onChange={(event) => onMaterialTaskChange(event.target.value)}
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
              Linked note
              <select
                aria-label="Reference linked note"
                value={materialDraft.noteId}
                disabled={materialSaving || noteOptionHistory.loading}
                onChange={(event) =>
                  onMaterialDraftChange("noteId", event.target.value)
                }
              >
                <option value="">No linked note</option>
                {noteOptions.map((note) => (
                  <option key={note.id} value={note.id}>
                    {noteOptionLabel(note)}
                  </option>
                ))}
              </select>
            </label>
            {noteOptionHistory.nextCursor && (
              <button
                className="text-button journal-note-options-more"
                type="button"
                disabled={noteOptionHistory.loading || materialSaving}
                onClick={noteOptionHistory.loadNext}
              >
                {noteOptionHistory.loading ? "Loading…" : "Load older notes"}
              </button>
            )}
            {noteOptionHistory.error && (
              <div className="journal-note-options-error" role="alert">
                <span>{noteOptionHistory.error}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={noteOptionHistory.retry}
                >
                  Retry notes
                </button>
              </div>
            )}
            <label>
              Project
              <select
                aria-label="Project"
                value={materialTaskProjectId ?? materialDraft.projectId}
                disabled={materialSaving || Boolean(materialTaskProjectId)}
                onChange={(event) =>
                  onMaterialDraftChange("projectId", event.target.value)
                }
              >
                <option value="">No Project</option>
                {[...projects.values()].map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {materialTaskProjectId && (
                <small>Inherited from linked task</small>
              )}
            </label>
            <button
              className="primary-button"
              disabled={materialSaving || !materialDraft.url.trim()}
              onClick={() => void onAddMaterial()}
            >
              <LinkIcon size={14} />
              {materialSaving ? "Saving…" : "Save reference"}
            </button>
          </section>
          <section className="journal-history-results">
            <JournalSearchControls
              kind="material"
              text={materialHistory.criteria.q}
              loading={materialHistory.loading}
              onTextChange={(q) =>
                materialHistory.setCriteria({ q })
              }
              onClear={() =>
                materialHistory.setCriteria({ q: "" })
              }
            />
            <ReferenceCards
              materials={materials}
              projects={projects}
              tasks={tasks}
              notes={noteOptions}
              emptyCopy={
                materialHistory.loading || materialHistory.error
                  ? ""
                  : referenceSearchActive
                    ? "No references match this search."
                    : "No references saved yet."
              }
            />
            <HistoryFooter
              noun="references"
              state={materialHistory}
              onLoadMore={materialHistory.loadNext}
              onRetry={materialHistory.retry}
            />
          </section>
        </div>
      )}
    </div>
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

function ArrangementControl({
  value,
  options,
  onChange
}: {
  value: BacklogArrange;
  options: Array<[BacklogArrange, string]>;
  onChange: (value: BacklogArrange) => void;
}) {
  return (
    <div className="arrange-control">
      <span>Arrange</span>
      <SegmentedControl
        ariaLabel="Arrange backlog by"
        value={value}
        options={options}
        onChange={onChange}
      />
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

function JournalSearchControls({
  kind,
  text,
  tag = "",
  loading,
  onTextChange,
  onTagChange,
  onClear
}: {
  kind: "note" | "material";
  text: string;
  tag?: string;
  loading: boolean;
  onTextChange: (value: string) => void;
  onTagChange?: (value: string) => void;
  onClear: () => void;
}) {
  const notes = kind === "note";
  const active = Boolean(text.trim() || (notes && tag.trim()));
  return (
    <div
      className="journal-search-controls"
      role="search"
      aria-label={notes ? "Search Notes" : "Search References"}
      aria-busy={loading}
    >
      <label>
        <span>{notes ? "Search Notes" : "Search References"}</span>
        <span className="journal-search-input">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={text}
            maxLength={JOURNAL_SEARCH_MAX_LENGTH}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={
              notes
                ? "Find text in complete Note history"
                : "Find reference names, links, or notes"
            }
          />
        </span>
      </label>
      {notes && onTagChange && (
        <label>
          <span>Filter by tag</span>
          <input
            value={tag}
            maxLength={NOTE_TAG_MAX_LENGTH}
            onChange={(event) => onTagChange(event.target.value)}
            placeholder="For example, decisions"
          />
        </label>
      )}
      {active && (
        <button className="text-button" type="button" onClick={onClear}>
          {notes ? "Clear filters" : "Clear search"}
        </button>
      )}
    </div>
  );
}

function NoteCards({
  notes,
  projects,
  tasks,
  onTagSelect,
  emptyCopy = "No notes captured today."
}: {
  notes: Note[];
  projects: Map<string, ProjectSummary>;
  tasks: JournalTaskOption[];
  onTagSelect?: (tag: string) => void;
  emptyCopy?: string;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return (
    <div className="note-list">
      {notes.map((note) => {
        const task = note.taskId ? taskById.get(note.taskId) : null;
        const projectId = task?.projectId ?? note.projectId;
        const details = [
          note.taskId ? `Task: ${task?.title ?? "Linked task"}` : "",
          projectId && projects.get(projectId)
            ? projects.get(projectId)?.name ?? ""
            : ""
        ].filter(Boolean);
        return (
          <article className="note-card" key={note.id}>
            <p>{note.content}</p>
            {note.tags.length > 0 && (
              <div className="note-tag-list" aria-label="Note tags">
                {note.tags.map((tag) =>
                  onTagSelect ? (
                    <button
                      className="note-tag"
                      type="button"
                      key={tag}
                      onClick={() => onTagSelect(tag)}
                    >
                      #{tag}
                    </button>
                  ) : (
                    <span className="note-tag" key={tag}>
                      #{tag}
                    </span>
                  )
                )}
              </div>
            )}
            {details.length > 0 && <small>{details.join(" · ")}</small>}
          </article>
        );
      })}
      {!notes.length && emptyCopy && <p className="empty-copy">{emptyCopy}</p>}
    </div>
  );
}

function ReferenceCards({
  materials,
  projects,
  tasks,
  notes,
  emptyCopy = "No references saved yet."
}: {
  materials: Material[];
  projects: Map<string, ProjectSummary>;
  tasks: JournalTaskOption[];
  notes: Note[];
  emptyCopy?: string;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const noteById = new Map(notes.map((note) => [note.id, note]));
  return (
    <div className="material-list">
      {materials.map((material) => {
        const task = material.taskId
          ? taskById.get(material.taskId)
          : null;
        const note = material.noteId
          ? noteById.get(material.noteId)
          : null;
        const projectId = task?.projectId ?? material.projectId;
        const details = [
          material.notes,
          material.taskId ? `Task: ${task?.title ?? "Linked task"}` : "",
          material.noteId
            ? `Note: ${note ? noteOptionLabel(note) : "Linked note"}`
            : "",
          projectId && projects.get(projectId)
            ? projects.get(projectId)?.name ?? ""
            : ""
        ].filter(Boolean);
        return (
          <a
            className="material-item"
            href={material.url}
            target="_blank"
            rel="noreferrer"
            key={material.id}
          >
            <span>{material.type}</span>
            <strong>{material.title}</strong>
            {details.length > 0 && <small>{details.join(" · ")}</small>}
            <ExternalLink size={13} />
          </a>
        );
      })}
      {!materials.length && emptyCopy && <p className="empty-copy">{emptyCopy}</p>}
    </div>
  );
}

/**
 * A tab count is only shown once it is actually known. These histories load on
 * demand, so promising a number and rendering an ellipsis forever is worse
 * than the plain name.
 */
function countedLabel(name: string, count: number | null) {
  return count === null ? name : `${name} · ${count}`;
}

function noteOptionLabel(note: Note) {
  const summary = note.content.replace(/\s+/g, " ").trim();
  return summary.length > 72 ? `${summary.slice(0, 71).trimEnd()}…` : summary;
}

function HistoryFooter<T>({
  noun,
  state,
  onLoadMore,
  onRetry
}: {
  noun: string;
  state: JournalHistoryState<T>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (state.error) {
    return (
      <div className="history-status" role="alert">
        <span>{state.error}</span>
        <button className="secondary-button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (state.loading) {
    return (
      <p className="history-status" role="status">
        Loading {noun}…
      </p>
    );
  }
  if (state.nextCursor) {
    return (
      <div className="history-status">
        <span>
          Showing {state.items.length}
          {state.totalCount === null ? "" : ` of ${state.totalCount}`} {noun}
        </span>
        <button className="secondary-button" onClick={onLoadMore}>
          Load more
        </button>
      </div>
    );
  }
  if (state.loaded && state.totalCount !== null) {
    return (
      <p className="history-status" role="status">
        All {state.totalCount} {noun} loaded.
      </p>
    );
  }
  return null;
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


function numberWord(value: number) {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
  return words[value] ?? String(value);
}

/**
 * A day with nothing on it has not been finished — it was never planned.
 * Saying "none left" in both cases claims a completion that did not happen.
 */
function todayHeadline(openCount: number, doneCount: number) {
  if (openCount === 0) {
    return doneCount === 0 ? "Nothing scheduled yet" : "All done for today";
  }
  return `${numberWord(openCount)} ${openCount === 1 ? "task" : "tasks"} left`;
}
