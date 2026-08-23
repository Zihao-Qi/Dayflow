"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BookOpen,
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
  Pencil,
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
import { ProjectsWorkspace } from "@/components/projects-workspace";
import { FocusDraft, FocusRail } from "@/components/focus-timer";
import { useFocusSession } from "@/components/focus-session-provider";
import { SaveStateChip, useSaveState } from "@/components/save-state";
import { useReviewHistory } from "@/components/use-review-history";
import type { PastReviewRecord } from "@/lib/review-records";
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
  focusElapsedSeconds,
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
import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  DEFAULT_ACTIVITY_CATEGORY
} from "@/lib/activity-categories";
import {
  formatInvestedMinutes,
  ProjectSummary
} from "@/lib/project-domain";
import {
  resolvePalette,
  type PaletteItem
} from "@/lib/command-palette";
import {
  REVIEW_INTENTION_MAX_LENGTH,
  REVIEW_NARRATIVE_MAX_LENGTH
} from "@/lib/review-domain";
import {
  isTimeBlockRecord,
  minutesToTimeBlockTime,
  TIME_BLOCK_LAST_MINUTE,
  TIME_BLOCK_SLOT_INTERVAL_MINUTES,
  type TimeBlockRecord,
  type TimeBlockTaskSummary,
  timeBlockDurationMinutes,
  timeBlockTimeToMinutes
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
type PendingMutation = { id: string; fingerprint: string };
type TimeBlockEditor = {
  id: string | null;
  date: string;
  originalTask: TimeBlockTaskSummary | null;
  linkedTask: TimeBlockTaskSummary | null;
  draft: TimeBlockEditorDraft;
};
type ActivityDraft = {
  date: string;
  time: string;
  duration: string;
  category: string;
  taskId: string;
  projectId: string;
  note: string;
};
type ActivityEditor = {
  original: ActivityEntry;
  draft: ActivityDraft;
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
type ActivityTaskOption = Pick<Task, "id" | "title" | "projectId">;
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

type ActivityEntry = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  origin: "MANUAL" | "FOCUS";
  taskId: string | null;
  projectId: string | null;
  attributedProjectId: string | null;
  focusSessionId: string | null;
  createdAt: string;
  updatedAt: string;
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

const TIMELINE_BASE_HOUR_HEIGHT_PX = 52;
const TIMELINE_DESKTOP_TARGET_HEIGHT_PX = 24;
const TIMELINE_TOUCH_TARGET_HEIGHT_PX = 44;
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

function reviewsEqual(left: Review, right: Review) {
  return (
    left.periodStart === right.periodStart &&
    left.periodEnd === right.periodEnd &&
    left.narrative === right.narrative &&
    left.nextPeriodIntention === right.nextPeriodIntention
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

function normalizeReview(review: Review): Review {
  return {
    ...review,
    narrative: review.narrative.trim(),
    nextPeriodIntention: review.nextPeriodIntention.trim()
  };
}

function hasReviewContent(review: Review) {
  return Boolean(
    review.narrative.trim() || review.nextPeriodIntention.trim()
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

function isActivityResponse(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<ActivityEntry>;
  return (
    typeof activity.id === "string" &&
    typeof activity.startedAt === "string" &&
    Number.isInteger(activity.durationMinutes) &&
    typeof activity.category === "string" &&
    typeof activity.note === "string" &&
    ["MANUAL", "FOCUS"].includes(String(activity.origin)) &&
    (activity.taskId === null || typeof activity.taskId === "string") &&
    (activity.projectId === null || typeof activity.projectId === "string") &&
    (activity.attributedProjectId === null ||
      typeof activity.attributedProjectId === "string") &&
    (activity.focusSessionId === null ||
      typeof activity.focusSessionId === "string") &&
    typeof activity.createdAt === "string" &&
    Number.isFinite(Date.parse(activity.createdAt)) &&
    typeof activity.updatedAt === "string" &&
    Number.isFinite(Date.parse(activity.updatedAt))
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

export function Dashboard() {
  const focus = useFocusSession();
  const { mode: layoutMode, figureArrangement, wideFocusRail } = useLayoutMode();
  const compactLayout = layoutMode !== "desktop";
  const phoneLayout = layoutMode === "phone";
  const [data, setData] = useState<Bootstrap | null>(null);
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
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityCreateDraft, setActivityCreateDraft] =
    useState<ActivityDraft>({
      date: "",
      time: "",
      duration: "30",
      category: DEFAULT_ACTIVITY_CATEGORY,
      taskId: "",
      projectId: "",
      note: ""
    });
  const [activityEditor, setActivityEditor] =
    useState<ActivityEditor | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activitySaving, setActivitySaving] = useState(false);
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
  const activityCreateWasInError = useRef(false);
  const activityEditWasInError = useRef(false);
  const taskCreateMutation = useRef<PendingMutation | null>(null);
  const noteCreateMutation = useRef<PendingMutation | null>(null);
  const materialCreateMutation = useRef<PendingMutation | null>(null);
  const activityCreateMutation = useRef<PendingMutation | null>(null);
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

    setActivityCreateDraft((current) => ({
      ...current,
      time: formatTimeInput(new Date())
    }));
    setFirstRunSeen(window.localStorage.getItem("dayflow-first-run-seen") === "1");
    void refresh();
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
          setFocusDraft({ revision: Date.now(), plannedMinutes: 25 });
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
    if (
      !response.ok ||
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
      throw new Error("Dayflow could not refresh its latest data.");
    }
    setData(result as Bootstrap);
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
  const activeActivityDraft =
    activityEditor?.draft ?? activityCreateDraft;
  const activityDialogTasks = useMemo(() => {
    const options: ActivityTaskOption[] = todayTasks.map(
      ({ id, title, projectId }) => ({ id, title, projectId })
    );
    const original = activityEditor?.original;
    if (!original?.taskId || options.some(({ id }) => id === original.taskId)) {
      return options;
    }
    const task =
      data?.tasks.find(({ id }) => id === original.taskId) ??
      data?.paletteTasks.find(({ id }) => id === original.taskId);
    options.push(
      task
        ? {
            id: task.id,
            title: task.title,
            projectId: task.projectId
          }
        : {
            id: original.taskId,
            title: "Previously linked task",
            projectId:
              original.projectId === null
                ? original.attributedProjectId
                : null
          }
    );
    return options;
  }, [activityEditor?.original, data?.paletteTasks, data?.tasks, todayTasks]);
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

  function openActivityCreate() {
    setActivityCreateDraft((current) =>
      current.note
        ? current
        : {
            ...current,
            date: data?.todayKey ?? current.date,
            time: formatTimeInput(new Date())
          }
    );
    setActivityEditor(null);
    setActivityError("");
    setActivityOpen(true);
  }

  function openActivityEdit(activity: ActivityEntry) {
    if (activity.origin !== "MANUAL" || activity.focusSessionId) return;
    setActivityEditor({
      original: activity,
      draft: {
        date: localDateKey(new Date(activity.startedAt)),
        time: formatTimeInput(new Date(activity.startedAt)),
        duration: String(activity.durationMinutes),
        category: activity.category,
        taskId: activity.taskId ?? "",
        projectId: activity.projectId ?? "",
        note: activity.note
      }
    });
    setActivityError("");
    setActivityOpen(true);
  }

  function changeActivityDraft(patch: Partial<ActivityDraft>) {
    if (activityEditor) {
      setActivityEditor((current) =>
        current
          ? { ...current, draft: { ...current.draft, ...patch } }
          : current
      );
    } else {
      setActivityCreateDraft((current) => ({ ...current, ...patch }));
    }
    setActivityError("");
  }

  function closeActivityDialog() {
    setActivityOpen(false);
    setActivityEditor(null);
    setActivityError("");
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
        openActivityCreate();
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
          plannedMinutes: 25
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

  async function saveActivity() {
    if (activitySaving) return;
    const editor = activityEditor;
    const draft = editor?.draft ?? activityCreateDraft;
    const minutes = Number(draft.duration);
    if (!draft.note.trim()) {
      setActivityError("Add a short note about what happened.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setActivityError("Duration must be between 1 and 1440 minutes.");
      return;
    }
    const selectedDate = draft.date.trim();
    if (
      !editor &&
      (!parseLocalDate(selectedDate) ||
        !data?.todayKey ||
        selectedDate > data.todayKey)
    ) {
      setActivityError("Choose today or an earlier Activity date.");
      return;
    }
    const selectedCategory = draft.category.trim();
    if (
      !selectedCategory ||
      selectedCategory.length > ACTIVITY_CATEGORY_MAX_LENGTH
    ) {
      setActivityError(
        `Category must contain 1 to ${ACTIVITY_CATEGORY_MAX_LENGTH} characters.`
      );
      return;
    }
    const editable = {
      startTime: draft.time,
      durationMinutes: minutes,
      category: selectedCategory,
      taskId: draft.taskId || null,
      projectId: draft.projectId || null,
      note: draft.note.trim()
    };
    const selectedTaskProjectId =
      activityDialogTasks.find(({ id }) => id === editable.taskId)?.projectId ??
      null;
    const expectedAttributedProjectId =
      editor &&
      editable.taskId === editor.original.taskId &&
      editable.projectId === editor.original.projectId &&
      editor.original.projectId === null &&
      editor.original.attributedProjectId
        ? editor.original.attributedProjectId
        : selectedTaskProjectId ?? editable.projectId;
    const payload = editor
      ? editable
      : { ...editable, date: selectedDate };
    const mutationId = editor
      ? null
      : mutationIdFor(activityCreateMutation, payload);
    setActivitySaving(true);
    try {
      const response = await fetch(
        editor
          ? `/api/activities/${encodeURIComponent(editor.original.id)}`
          : "/api/activities",
        {
          method: editor ? "PUT" : "POST",
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
      const expectedDate = editor
        ? localDateKey(new Date(editor.original.startedAt))
        : selectedDate;
      if (
        !response.ok ||
        !isActivityResponse(result) ||
        (editor && result.id !== editor.original.id) ||
        (editor && result.createdAt !== editor.original.createdAt) ||
        (editor &&
          Date.parse(result.updatedAt) <=
            Date.parse(editor.original.updatedAt)) ||
        result.origin !== "MANUAL" ||
        result.focusSessionId !== null ||
        localDateKey(new Date(result.startedAt)) !== expectedDate ||
        formatTimeInput(new Date(result.startedAt)) !== editable.startTime ||
        result.note !== payload.note ||
        result.durationMinutes !== payload.durationMinutes ||
        result.category !== payload.category ||
        result.taskId !== editable.taskId ||
        result.projectId !== editable.projectId ||
        result.attributedProjectId !== expectedAttributedProjectId
      ) {
        setActivityError(
          result && typeof result.error === "string"
            ? result.error
            : editor
              ? "Activity could not be updated. Your draft is still here."
              : "Activity could not be saved. Your draft is still here."
        );
        if (editor) {
          activityEditWasInError.current = true;
        } else {
          activityCreateWasInError.current = true;
        }
        return;
      }
      if (editor) {
        setData((current) =>
          current
            ? {
                ...current,
                activities: current.activities
                  .map((activity) =>
                    activity.id === result.id ? result : activity
                  )
                  .sort(
                    (left, right) =>
                      new Date(right.startedAt).getTime() -
                      new Date(left.startedAt).getTime()
                  )
              }
            : current
        );
        setActivityEditor(null);
      } else {
        setActivityCreateDraft((current) => ({
          ...current,
          date: data?.todayKey ?? current.date,
          note: "",
          taskId: "",
          projectId: ""
        }));
        activityCreateMutation.current = null;
        if (selectedDate !== data?.todayKey) {
          setAppAnnouncement(
            `Activity saved for ${formatLongLocalDateKey(selectedDate)}.`
          );
        }
      }
      setActivityError("");
      setActivityOpen(false);
      if (
        editor
          ? activityEditWasInError.current
          : activityCreateWasInError.current
      ) {
        activityEditWasInError.current = false;
        activityCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch {
      setActivityError(
        editor
          ? "Activity could not be updated. Your draft is still here."
          : "Activity could not be saved. Your draft is still here."
      );
      if (editor) {
        activityEditWasInError.current = true;
      } else {
        activityCreateWasInError.current = true;
      }
    } finally {
      setActivitySaving(false);
    }
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

  function openTimeBlockEditor(task: Task | null = null) {
    if (!data) return;
    const durationMinutes = suggestedTaskBlockDuration(task);
    const slot = defaultTimeBlockTimes(durationMinutes);
    setTimeBlockError("");
    setTimeBlockErrorField(null);
    setTimeBlockEditor({
      id: null,
      date: data.todayKey,
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
        todayTasks.find((item) => item.id === taskId) ??
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
      if (!refreshed) {
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

  if (!data) {
    return (
      <main className="loading-screen">
        <RefreshCw className="spin" size={22} />
        <span>Opening Dayflow</span>
      </main>
    );
  }

  const timeBlockDialogTasks = mergeTimeBlockTaskOptions(
    openTodayTasks,
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
              setFocusDraft({ revision: Date.now(), plannedMinutes: 25 });
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
            tasks={openTodayTasks}
            activities={data.activities}
            timeBlocks={data.timeBlocks}
            projects={projectById}
            blockedMinutes={blockedMinutes}
            recordedMinutes={activityMinutes}
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
            onEditActivity={openActivityEdit}
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

      {activityOpen && (
        <ActivityDialog
          mode={activityEditor ? "edit" : "create"}
          tasks={activityDialogTasks}
          projects={data.projects}
          todayKey={data.todayKey}
          categorySuggestions={data.activityCategorySuggestions}
          draft={activeActivityDraft}
          originalTaskId={activityEditor?.original.taskId ?? null}
          originalInheritedProjectId={
            activityEditor?.original.taskId &&
            activityEditor.original.projectId === null
              ? activityEditor.original.attributedProjectId
              : null
          }
          error={activityError}
          saving={activitySaving}
          onDraftChange={changeActivityDraft}
          onClose={closeActivityDialog}
          onSave={saveActivity}
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

function DayPage({
  view,
  today,
  todayKey,
  tasks,
  activities,
  timeBlocks,
  projects,
  blockedMinutes,
  recordedMinutes,
  noteCount,
  activeFocus,
  focusNow,
  focusBusy,
  onViewChange,
  onStartFocus,
  onQueueTask,
  onFocusTransition,
  onOpenPalette,
  onCreateTimeBlock,
  onEditTimeBlock,
  onEditActivity
}: {
  view: DayView;
  today: string;
  todayKey: string;
  tasks: Task[];
  activities: ActivityEntry[];
  timeBlocks: TimeBlock[];
  projects: Map<string, ProjectSummary>;
  blockedMinutes: number;
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
  onCreateTimeBlock: (task?: Task | null) => void;
  onEditTimeBlock: (block: TimeBlock) => void;
  onEditActivity: (activity: ActivityEntry) => void;
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
        <span>{formatMinutes(blockedMinutes)} blocked</span>
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
          onEditActivity={onEditActivity}
        />
      )}
      {view === "timeline" && (
        <DayTimeline
          todayKey={todayKey}
          blocks={timeBlocks}
          tasks={tasks}
          activities={activities}
          activeFocus={activeFocus}
          focusNow={focusNow}
          onCreateBlock={onCreateTimeBlock}
          onEditBlock={onEditTimeBlock}
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
  onOpenPalette,
  onEditActivity
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
  onEditActivity: (activity: ActivityEntry) => void;
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
        {[...activities].reverse().map((activity) => {
          const projectId =
            activity.attributedProjectId ?? activity.projectId;
          return (
            <article className="stream-row complete" key={activity.id}>
              <time>{formatActivityTime(activity.startedAt)}</time>
              <div>
                <i />
                <div className="stream-activity-heading">
                  <strong>
                    {activity.durationMinutes}m · {activity.category}
                  </strong>
                  {activity.origin === "MANUAL" &&
                    activity.focusSessionId === null && (
                      <button
                        aria-label={`Edit activity: ${activity.note}`}
                        className="stream-activity-edit"
                        onClick={() => onEditActivity(activity)}
                        type="button"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                    )}
                </div>
                <p>{activity.note}</p>
                {projectId && projects.get(projectId) && (
                  <span>{projects.get(projectId)?.name}</span>
                )}
              </div>
            </article>
          );
        })}
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
                  <strong>Nothing running · {tasks.length} tasks left</strong>
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
  todayKey,
  blocks,
  tasks,
  activities,
  activeFocus,
  focusNow,
  onCreateBlock,
  onEditBlock
}: {
  todayKey: string;
  blocks: TimeBlock[];
  tasks: Task[];
  activities: ActivityEntry[];
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
  onCreateBlock: (task?: Task | null) => void;
  onEditBlock: (block: TimeBlock) => void;
}) {
  const todayBlocks = blocks
    .filter((block) => block.date === todayKey)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.endTime.localeCompare(right.endTime) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
  const bounds = timelineBounds(todayBlocks, activities, activeFocus, focusNow);
  const timelineScales = timelineHourHeights(todayBlocks);
  const timelineStyle = {
    "--timeline-desktop-hour-height": `${timelineScales.desktop}px`,
    "--timeline-touch-hour-height": `${timelineScales.touch}px`,
    "--timeline-desktop-height": `${
      bounds.hourCount * timelineScales.desktop
    }px`,
    "--timeline-touch-height": `${
      bounds.hourCount * timelineScales.touch
    }px`
  } as CSSProperties;
  return (
    <section className="day-view">
      <p className="view-explainer">
        Planned time and focused time share one grid so gaps and overages stay honest.
      </p>
      <div className="timeline-planning-toolbar">
        <div>
          <span className="eyebrow">Manual plan</span>
          <strong>
            {todayBlocks.length
              ? `${todayBlocks.length} ${
                  todayBlocks.length === 1 ? "block" : "blocks"
                } · ${formatMinutes(
                  todayBlocks.reduce(
                    (sum, block) =>
                      sum + safeTimeBlockDurationMinutes(block),
                    0
                  )
                )}`
              : "No time blocked yet"}
          </strong>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onCreateBlock(null)}
        >
          <Plus size={14} />
          Add time block
        </button>
      </div>
      {tasks.length > 0 && (
        <div className="timeline-task-shortcuts" aria-label="Block a task">
          <span>Block a task</span>
          <div>
            {tasks.map((task) => (
              <button
                aria-label={`Block time for ${task.title}`}
                key={task.id}
                onClick={() => onCreateBlock(task)}
                type="button"
              >
                <span>{task.title}</span>
                <small>{task.estimateMinutes || 30}m</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="day-timeline-scroll">
        <div className="day-timeline-panel" style={timelineStyle}>
          <div className="timeline-corner" />
          <span className="timeline-column-label">Planned</span>
          <span className="timeline-column-label focused">Focused</span>
          <div className="timeline-hours">
            {Array.from({ length: bounds.hourCount }, (_, index) => (
              <span key={index}>{formatHour(index + bounds.startHour)}</span>
            ))}
          </div>
          <div className="timeline-column">
            {todayBlocks.map((block) => {
              const interval = safeTimeBlockInterval(block);
              if (!interval) return null;
              return (
                <button
                  aria-label={`Time block: ${block.title}, ${block.startTime} to ${block.endTime}`}
                  className="planned-block"
                  key={block.id}
                  onClick={() => onEditBlock(block)}
                  style={timelinePosition(
                    interval.startMinutes,
                    interval.endMinutes - interval.startMinutes,
                    bounds.startHour,
                    bounds.hourCount
                  )}
                  type="button"
                >
                  <strong>{block.title}</strong>
                  <small>
                    {block.startTime}–{block.endTime}
                  </small>
                </button>
              );
            })}
            {!todayBlocks.length && (
              <button
                className="timeline-empty"
                onClick={() => onCreateBlock(null)}
                style={timelinePosition(
                  Math.max(9, bounds.startHour) * 60,
                  60,
                  bounds.startHour,
                  bounds.hourCount
                )}
                type="button"
              >
                Nothing planned · add a block
              </button>
            )}
          </div>
          <div className="timeline-column actual">
            {activities.map((activity) => {
              const date = new Date(activity.startedAt);
              const start = date.getHours() * 60 + date.getMinutes();
              return (
                <article
                  className="focused-block"
                  key={activity.id}
                  style={timelinePosition(
                    start,
                    activity.durationMinutes,
                    bounds.startHour,
                    bounds.hourCount
                  )}
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
                  Math.max(
                    20,
                    Math.floor(
                      focusElapsedSeconds(activeFocus, focusNow) / 60
                    )
                  ),
                  bounds.startHour,
                  bounds.hourCount
                )}
              >
                <strong>{activeFocus.label}</strong>
                <small>running</small>
              </article>
            )}
          </div>
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
            value={view}
            options={[
              ["daily", "Daily page"],
              [
                "notes",
                `Notes · ${noteHistory.totalCount ?? (view === "notes" ? notes.length : "…")}`
              ],
              [
                "references",
                `References · ${
                  materialHistory.totalCount ??
                  (view === "references" ? materials.length : "…")
                }`
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

function ReviewPage({
  projects,
  review,
  summary,
  onSaveReview,
  onSaveError,
  onSaveRecovered,
  onOpenProject
}: {
  projects: ProjectSummary[];
  review: Review;
  summary: ReviewSummary;
  onSaveReview: (review: Review) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  onOpenProject: (id: string) => void;
}) {
  const history = useReviewHistory();
  const past = history.selected;
  const activeSummary: ReviewSummary = past ? past.reviewSummary : summary;
  const activeProjects: ReviewMovedProject[] = past ? past.projects : projects;
  const activePeriodEnd = past ? past.review.periodEnd : review.periodEnd;

  return (
    <div className="review-page page-stack">
      <PageHeader
        eyebrow={`${
          past ? "Past review \u00b7 seven days ending" : "Seven days ending"
        } ${formatReviewPeriodEnd(activePeriodEnd)}`}
        title="Review"
        actions={
          <button
            type="button"
            className="secondary-button"
            aria-expanded={history.open}
            onClick={history.open ? history.closeHistory : history.openHistory}
          >
            <BookOpen size={14} />
            {history.open ? "Hide earlier reviews" : "Earlier reviews"}
          </button>
        }
      />

      {history.open && (
        <ReviewHistoryPanel history={history} />
      )}

      <ReviewEvidenceSections
        summary={activeSummary}
        projects={activeProjects}
        onOpenProject={onOpenProject}
      />

      {past ? (
        <PastReviewCard
          review={past.review}
          onReturnToCurrent={history.clearSelection}
        />
      ) : (
        <CurrentReviewEditor
          key={`${review.periodStart}:${review.periodEnd}`}
          review={review}
          onSaveReview={onSaveReview}
          onSaveError={onSaveError}
          onSaveRecovered={onSaveRecovered}
        />
      )}
    </div>
  );
}

type ReviewMovedProject = {
  id: string;
  name: string;
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number | null;
  reviewPeriodInvestedMinutes: number;
  movedDuringReviewPeriod: boolean;
};

function ReviewEvidenceSections({
  summary,
  projects,
  onOpenProject
}: {
  summary: ReviewSummary;
  projects: ReviewMovedProject[];
  onOpenProject: (id: string) => void;
}) {
  const moved = projects.filter(
    (project) => project.movedDuringReviewPeriod
  );
  const categories = summary.categoryMinutes.filter(
    (item) => item.minutes > 0
  );
  const diaryAverageNote =
    summary.diaryDayCount === 0
      ? "no saved Diary days"
      : `across ${summary.diaryDayCount} saved Diary ${
          summary.diaryDayCount === 1 ? "day" : "days"
        }`;

  return (
    <>
      <dl className="review-metrics" aria-label="Review period totals">
        <ReviewMetric
          label="Recorded"
          value={formatMinutes(summary.recordedMinutes)}
          note="Activity time"
        />
        <ReviewMetric
          label="Focused"
          value={formatMinutes(summary.focusedMinutes)}
          note="Focus-origin Activity"
        />
        <ReviewMetric
          label="Tasks done"
          value={String(summary.completedTaskCount)}
          note={
            summary.completedTaskCount === 1
              ? "task completed"
              : "tasks completed"
          }
        />
        <ReviewMetric
          label="Diary days"
          value={`${summary.diaryDayCount}/7`}
          note="intentionally saved"
        />
      </dl>

      <div className="review-evidence-grid">
        <section
          className="panel review-evidence-panel"
          aria-labelledby="review-evidence-heading"
        >
          <div className="review-panel-heading">
            <div>
              <span className="eyebrow">Supporting evidence</span>
              <h2 id="review-evidence-heading">Evidence captured</h2>
            </div>
          </div>
          <dl className="review-evidence-counts">
            <ReviewMetric
              label="Notes"
              value={String(summary.noteCount)}
              note={summary.noteCount === 1 ? "note captured" : "notes captured"}
            />
            <ReviewMetric
              label="References"
              value={String(summary.materialCount)}
              note={
                summary.materialCount === 1
                  ? "reference saved"
                  : "references saved"
              }
            />
            <ReviewMetric
              label="Projects"
              value={String(summary.movedProjectCount)}
              note="moved forward"
            />
            <ReviewMetric
              label="Average mood"
              value={formatDiaryAverage(summary.averageMood)}
              note={diaryAverageNote}
            />
            <ReviewMetric
              label="Average energy"
              value={formatDiaryAverage(summary.averageEnergy)}
              note={diaryAverageNote}
            />
          </dl>
          <p className="review-missing-evidence-note">
            Mood and energy average only saved Diary days. Missing days stay
            missing.
          </p>
        </section>

        <section
          className="panel review-category-panel"
          aria-labelledby="review-category-heading"
        >
          <div className="review-panel-heading">
            <div>
              <span className="eyebrow">Activity distribution</span>
              <h2 id="review-category-heading">Where the time went</h2>
            </div>
            <strong>{formatMinutes(summary.recordedMinutes)}</strong>
          </div>
          {categories.length ? (
            <ul
              className="review-category-list"
              aria-label="Activity time by category"
            >
              {categories.map((item) => {
                const percentage = Math.round(
                  (item.minutes / Math.max(summary.recordedMinutes, 1)) * 100
                );
                return (
                  <li key={item.category}>
                    <div className="review-category-copy">
                      <span>{item.category}</span>
                      <strong>{formatMinutes(item.minutes)}</strong>
                      <small>{percentage}%</small>
                    </div>
                    <div className="review-category-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.max(0, Math.min(percentage, 100))}%`
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="review-empty-copy">
              No Activity time was recorded in this review period.
            </p>
          )}
        </section>
      </div>

      {summary.pendingEnrichmentSessions > 0 && (
        <p className="review-pending-note" role="status">
          <Check size={14} />
          <span>
            <strong>
              {formatMinutes(summary.pendingEnrichmentMinutes)} is already
              counted.
            </strong>{" "}
            {summary.pendingEnrichmentSessions === 1
              ? "This session"
              : "These sessions"}{" "}
            can receive optional notes and categories later.
          </span>
        </p>
      )}

      <section
        className="panel moved-projects"
        aria-labelledby="review-projects-heading"
      >
        <div className="review-panel-heading">
          <div>
            <span className="eyebrow">Outcomes in motion</span>
            <h2 id="review-projects-heading">Projects moved forward</h2>
          </div>
          <strong>{summary.movedProjectCount}</strong>
        </div>
        <div className="review-project-list">
          {moved.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenProject(project.id)}
            >
              <strong>{project.name}</strong>
              <div className="meter" aria-hidden="true">
                <i style={{ width: `${project.progressPercent ?? 0}%` }} />
              </div>
              <small>
                {project.completedTaskCount}/{project.taskCount} tasks ·{" "}
                {formatInvestedMinutes(
                  project.reviewPeriodInvestedMinutes
                )}{" "}
                invested this review period
              </small>
            </button>
          ))}
          {!moved.length && (
            <p>No project movement was recorded in this review period.</p>
          )}
        </div>
      </section>
    </>
  );
}

function CurrentReviewEditor({
  review,
  onSaveReview,
  onSaveError,
  onSaveRecovered
}: {
  review: Review;
  onSaveReview: (review: Review) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
}) {
  const reviewSave = useSaveState<Review>({
    value: review,
    save: onSaveReview,
    normalize: normalizeReview,
    isEqual: reviewsEqual,
    isValid: hasReviewContent,
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  });
  const hasDraft = hasReviewContent(reviewSave.draft);

  return (
      <section
        className="panel review-editor-card"
        aria-labelledby="review-editor-heading"
      >
        <div className="review-editor-heading">
          <div>
            <span className="eyebrow">Saved separately from Journal</span>
            <h2 id="review-editor-heading">Your review</h2>
          </div>
          <div
            className="review-save-state"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <SaveStateChip
              state={reviewSave.state}
              onRetry={() => void reviewSave.flush(true)}
            />
          </div>
        </div>
        <p className="review-editor-intro">
          Interpret the evidence without changing it. This writing belongs to
          this exact seven-day period, not today&apos;s Diary.
        </p>
        <form
          className="review-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void reviewSave.flush(true);
          }}
        >
          <div className="review-writing-fields">
            <label htmlFor="review-narrative">
              <span>Looking back</span>
              <strong>What moved forward?</strong>
              <textarea
                id="review-narrative"
                aria-label="What moved forward?"
                value={reviewSave.draft.narrative}
                maxLength={REVIEW_NARRATIVE_MAX_LENGTH}
                aria-describedby="review-narrative-help"
                onChange={(event) =>
                  reviewSave.setDraft({
                    ...reviewSave.draft,
                    narrative: event.target.value
                  })
                }
                {...reviewSave.inputProps}
              />
              <small id="review-narrative-help">
                A short account grounded in the evidence above ·{" "}
                {reviewSave.draft.narrative.length.toLocaleString()}/
                {REVIEW_NARRATIVE_MAX_LENGTH.toLocaleString()}
              </small>
            </label>
            <label htmlFor="review-intention">
              <span>Looking ahead</span>
              <strong>What deserves protection next?</strong>
              <textarea
                id="review-intention"
                aria-label="What deserves protection next?"
                value={reviewSave.draft.nextPeriodIntention}
                maxLength={REVIEW_INTENTION_MAX_LENGTH}
                aria-describedby="review-intention-help"
                onChange={(event) =>
                  reviewSave.setDraft({
                    ...reviewSave.draft,
                    nextPeriodIntention: event.target.value
                  })
                }
                {...reviewSave.inputProps}
              />
              <small id="review-intention-help">
                One intention for the next seven days ·{" "}
                {reviewSave.draft.nextPeriodIntention.length.toLocaleString()}/
                {REVIEW_INTENTION_MAX_LENGTH.toLocaleString()}
              </small>
            </label>
          </div>
          <div className="review-editor-actions">
            <p>
              {hasDraft
                ? "Changes also save after a short pause, on blur, or with ⌘/Ctrl+Enter."
                : "Write in at least one field to save this Review."}
            </p>
            <button
              type="submit"
              className="primary-button"
              disabled={!hasDraft || reviewSave.state === "saving"}
            >
              <Save size={14} />
              {reviewSave.state === "saving" ? "Saving…" : "Save review"}
            </button>
          </div>
        </form>
      </section>
  );
}

function PastReviewCard({
  review,
  onReturnToCurrent
}: {
  review: PastReviewRecord;
  onReturnToCurrent: () => void;
}) {
  return (
    <section
      className="panel review-editor-card review-past-card"
      aria-labelledby="review-past-heading"
    >
      <div className="review-editor-heading">
        <div>
          <span className="eyebrow">Saved for this period</span>
          <h2 id="review-past-heading">Your review</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onReturnToCurrent}
        >
          Back to this week
        </button>
      </div>
      <p className="review-editor-intro">
        This review belongs to a period that has already ended, so it is shown
        as it was written. The evidence above is derived from your records as
        they exist now.
      </p>
      <div className="review-past-writing">
        <section aria-labelledby="review-past-narrative-heading">
          <span className="eyebrow">Looking back</span>
          <h3 id="review-past-narrative-heading">What moved forward?</h3>
          {review.narrative ? (
            <p className="review-past-text">{review.narrative}</p>
          ) : (
            <p className="review-empty-copy">
              Nothing was written for this field.
            </p>
          )}
        </section>
        <section aria-labelledby="review-past-intention-heading">
          <span className="eyebrow">Looking ahead</span>
          <h3 id="review-past-intention-heading">
            What deserves protection next?
          </h3>
          {review.nextPeriodIntention ? (
            <p className="review-past-text">{review.nextPeriodIntention}</p>
          ) : (
            <p className="review-empty-copy">
              Nothing was written for this field.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

function ReviewHistoryPanel({
  history
}: {
  history: ReturnType<typeof useReviewHistory>;
}) {
  return (
    <section
      className="panel review-history-panel"
      aria-labelledby="review-history-heading"
    >
      <div className="review-panel-heading">
        <div>
          <span className="eyebrow">Saved reviews</span>
          <h2 id="review-history-heading">Earlier reviews</h2>
        </div>
        {history.totalCount !== null && (
          <strong>{history.totalCount}</strong>
        )}
      </div>

      {history.error ? (
        <p className="review-history-error" role="alert">
          <span>{history.error}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={history.retry}
          >
            Try again
          </button>
        </p>
      ) : !history.loaded && history.loading ? (
        <p className="review-empty-copy" role="status">
          Loading earlier reviews\u2026
        </p>
      ) : history.loaded && !history.items.length ? (
        <p className="review-empty-copy">
          No earlier review has been saved yet. A review joins this list once
          its seven-day period has ended.
        </p>
      ) : (
        <>
          <ul
            className="review-history-list"
            aria-label="Reviews saved for earlier periods"
          >
            {history.items.map((item) => {
              const selected = history.selected?.review.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => void history.select(item.id)}
                  >
                    <strong>
                      Seven days ending {formatReviewPeriodEnd(item.periodEnd)}
                    </strong>
                    <small>
                      {item.narrative ||
                        item.nextPeriodIntention ||
                        "No writing saved"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
          {history.selectionError && (
            <p className="review-history-error" role="alert">
              {history.selectionError}
            </p>
          )}
          {history.nextCursor && (
            <button
              type="button"
              className="secondary-button"
              disabled={history.loading}
              onClick={history.loadNext}
            >
              {history.loading ? "Loading\u2026" : "Show older reviews"}
            </button>
          )}
        </>
      )}
    </section>
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
          type="button"
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
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        <small>{note}</small>
      </dd>
    </div>
  );
}

function timelineBounds(
  blocks: TimeBlock[],
  activities: ActivityEntry[],
  activeFocus: ReturnType<typeof useFocusSession>["active"],
  focusNow: number
) {
  let earliestMinutes = 8 * 60;
  let latestMinutes = 18 * 60;
  for (const block of blocks) {
    const interval = safeTimeBlockInterval(block);
    if (!interval) continue;
    earliestMinutes = Math.min(earliestMinutes, interval.startMinutes);
    latestMinutes = Math.max(latestMinutes, interval.endMinutes);
  }
  for (const activity of activities) {
    const startedAt = new Date(activity.startedAt);
    const start = startedAt.getHours() * 60 + startedAt.getMinutes();
    earliestMinutes = Math.min(earliestMinutes, start);
    latestMinutes = Math.max(
      latestMinutes,
      start + activity.durationMinutes
    );
  }
  if (activeFocus) {
    const startedAt = new Date(activeFocus.startedAt);
    const start = startedAt.getHours() * 60 + startedAt.getMinutes();
    earliestMinutes = Math.min(earliestMinutes, start);
    latestMinutes = Math.max(
      latestMinutes,
      start + Math.max(20, focusElapsedSeconds(activeFocus, focusNow) / 60)
    );
  }
  const startHour = Math.max(
    0,
    Math.min(23, Math.floor(earliestMinutes / 60))
  );
  const endHour = Math.max(
    startHour + 1,
    Math.min(24, Math.ceil(latestMinutes / 60))
  );
  return { startHour, endHour, hourCount: endHour - startHour };
}

function timelinePosition(
  startMinutes: number,
  durationMinutes: number,
  startHour: number,
  hourCount: number
) {
  const timelineMinutes = Math.max(60, hourCount * 60);
  const top =
    ((startMinutes - startHour * 60) / timelineMinutes) * 100;
  const height = (durationMinutes / timelineMinutes) * 100;
  return { top: `${top}%`, height: `${height}%` };
}

function timelineHourHeights(blocks: TimeBlock[]) {
  const shortestBlock = blocks.reduce((shortest, block) => {
    const duration = safeTimeBlockDurationMinutes(block);
    return duration > 0 ? Math.min(shortest, duration) : shortest;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(shortestBlock)) {
    return {
      desktop: TIMELINE_BASE_HOUR_HEIGHT_PX,
      touch: TIMELINE_BASE_HOUR_HEIGHT_PX
    };
  }
  return {
    desktop: Math.max(
      TIMELINE_BASE_HOUR_HEIGHT_PX,
      Math.ceil(
        (TIMELINE_DESKTOP_TARGET_HEIGHT_PX * 60) / shortestBlock
      )
    ),
    touch: Math.max(
      TIMELINE_BASE_HOUR_HEIGHT_PX,
      Math.ceil(
        (TIMELINE_TOUCH_TARGET_HEIGHT_PX * 60) / shortestBlock
      )
    )
  };
}

function safeTimeBlockInterval(block: TimeBlock) {
  try {
    const startMinutes = timeBlockTimeToMinutes(block.startTime);
    const endMinutes = timeBlockTimeToMinutes(block.endTime);
    return startMinutes < endMinutes
      ? { startMinutes, endMinutes }
      : null;
  } catch {
    return null;
  }
}

function safeTimeBlockDurationMinutes(block: TimeBlock) {
  try {
    return timeBlockDurationMinutes(block);
  } catch {
    return 0;
  }
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

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatLongLocalDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
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

function formatReviewPeriodEnd(periodEnd: string) {
  const lastMoment = new Date(new Date(periodEnd).getTime() - 1);
  return lastMoment.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatDiaryAverage(value: number | null) {
  if (value === null) return "Not recorded";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}/5`;
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
