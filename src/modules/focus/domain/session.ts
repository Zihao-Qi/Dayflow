import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import { appErrorConstructor } from "@/shared/kernel/error-compat";
import { requestErrors } from "@/shared/kernel/request-errors";
import {
  parseBoundedInteger as kernelParseBoundedInteger,
  parseEnum as kernelParseEnum,
  requireObject as kernelRequireObject,
  parseBoundedString,
  parseRecordId
} from "@/shared/kernel/parsing";

export type FocusSessionStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";
export type FocusSessionKind = "FOCUS" | "BREAK";

export type FocusSessionRecord = {
  id: string;
  kind: FocusSessionKind;
  plannedMinutes: number;
  actualMinutes: number;
  label: string;
  startedAt: string;
  pausedAt: string | null;
  accumulatedPauseSeconds: number;
  status: FocusSessionStatus;
  completedAt: string | null;
  needsEnrichment: boolean;
  enrichedAt: string | null;
  completionNote: string | null;
  completionCategory: string | null;
  taskId: string | null;
  projectId: string | null;
  task: {
    id: string;
    title: string;
    projectId: string | null;
    project: { id: string; name: string } | null;
    phase: { id: string; name: string } | null;
  } | null;
  project: { id: string; name: string } | null;
};

export type FocusTodayStats = {
  completedSessions: number;
  focusedMinutes: number;
};

export type FocusSnapshot = {
  active: FocusSessionRecord | null;
  pendingCompletion: FocusSessionRecord | null;
  today: FocusTodayStats;
};

export function isFocusSessionRecord(
  value: unknown
): value is FocusSessionRecord {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<FocusSessionRecord>;
  return (
    typeof session.id === "string" &&
    ["FOCUS", "BREAK"].includes(String(session.kind)) &&
    Number.isInteger(session.plannedMinutes) &&
    Number(session.plannedMinutes) >= 1 &&
    Number.isInteger(session.actualMinutes) &&
    Number(session.actualMinutes) >= 0 &&
    typeof session.label === "string" &&
    typeof session.startedAt === "string" &&
    (session.pausedAt === null || typeof session.pausedAt === "string") &&
    Number.isInteger(session.accumulatedPauseSeconds) &&
    Number(session.accumulatedPauseSeconds) >= 0 &&
    ["RUNNING", "PAUSED", "COMPLETED", "CANCELED"].includes(
      String(session.status)
    ) &&
    (session.completedAt === null ||
      typeof session.completedAt === "string") &&
    typeof session.needsEnrichment === "boolean" &&
    (session.enrichedAt === null || typeof session.enrichedAt === "string") &&
    (session.completionNote === null ||
      typeof session.completionNote === "string") &&
    (session.completionCategory === null ||
      typeof session.completionCategory === "string") &&
    (session.taskId === null || typeof session.taskId === "string") &&
    (session.projectId === null || typeof session.projectId === "string") &&
    isFocusTaskReference(session.task) &&
    isFocusProjectReference(session.project)
  );
}

export function isFocusSnapshot(value: unknown): value is FocusSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FocusSnapshot>;
  if (!snapshot.today || typeof snapshot.today !== "object") return false;
  const today = snapshot.today as Partial<FocusTodayStats>;
  return (
    (snapshot.active === null || isFocusSessionRecord(snapshot.active)) &&
    (snapshot.pendingCompletion === null ||
      isFocusSessionRecord(snapshot.pendingCompletion)) &&
    Number.isInteger(today.completedSessions) &&
    Number(today.completedSessions) >= 0 &&
    Number.isInteger(today.focusedMinutes) &&
    Number(today.focusedMinutes) >= 0
  );
}

export function isFocusStartResponse(
  value: unknown
): value is { session: FocusSessionRecord; snapshot: FocusSnapshot } {
  if (!value || typeof value !== "object") return false;
  const result = value as {
    session?: unknown;
    snapshot?: unknown;
  };
  return (
    isFocusSessionRecord(result.session) &&
    result.session.status === "RUNNING" &&
    isFocusSnapshot(result.snapshot) &&
    result.snapshot.active?.id === result.session.id
  );
}

function isFocusProjectReference(
  value: unknown
): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const project = value as { id?: unknown; name?: unknown };
  return typeof project.id === "string" && typeof project.name === "string";
}

function isFocusTaskReference(
  value: unknown
): value is FocusSessionRecord["task"] {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const task = value as {
    id?: unknown;
    title?: unknown;
    projectId?: unknown;
    project?: unknown;
    phase?: unknown;
  };
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.projectId === null || typeof task.projectId === "string") &&
    isFocusProjectReference(task.project) &&
    isFocusProjectReference(task.phase)
  );
}

export function focusElapsedSeconds(session: FocusSessionRecord, now: number) {
  return elapsedSeconds(session, now);
}

export function focusRemainingSeconds(session: FocusSessionRecord, now: number) {
  return Math.max(0, session.plannedMinutes * 60 - focusElapsedSeconds(session, now));
}

export function formatFocusClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function suggestedBreakMinutes(focusMinutes: number) {
  if (focusMinutes >= 50) return 10;
  if (focusMinutes >= 25) return 5;
  return Math.max(2, Math.round(focusMinutes / 5));
}

/**
 * The focus duration every entry point proposes before the user chooses one.
 * The Focus Rail, the sidebar button, the ⌘⇧F shortcut, and the Capture
 * palette must all open on the same number.
 */
export const DEFAULT_FOCUS_MINUTES = 25;

export const FOCUS_LABEL_MAX_LENGTH = 500;
export const FOCUS_COMPLETION_NOTE_MAX_LENGTH = 5_000;
export const FOCUS_CATEGORY_MAX_LENGTH = 100;

const focusKinds = ["FOCUS", "BREAK"] as const;
const focusActions = [
  "pause",
  "resume",
  "cancel",
  "complete",
  "enrich",
  "record"
] as const;

type JsonObject = Record<string, unknown>;
type FocusKind = (typeof focusKinds)[number];
export type FocusAction = (typeof focusActions)[number];
export function parseFocusSessionStartMutation(value: unknown): {
  kind: FocusKind;
  plannedMinutes: number;
  label?: string;
  taskId: string | null;
  projectId: string | null;
} {
  const body = requireObject(value);
  const kind =
    body.kind === undefined || body.kind === null || body.kind === ""
      ? "FOCUS"
      : parseEnum(
        typeof body.kind === "string"
          ? body.kind.trim().toUpperCase()
          : body.kind,
        focusKinds,
        "kind",
        focusErrors.timerKindMustBeFOCUSOrBREAK.message
      );
  const label = parseOptionalText(
    body.label,
    "label",
    "Timer label",
    FOCUS_LABEL_MAX_LENGTH
  );

  return {
    kind,
    plannedMinutes: parseBoundedInteger(
      body.plannedMinutes,
      "plannedMinutes",
      1,
      240,
      focusErrors.timerDurationMustBeBetween1And240Minutes.message
    ),
    label: label || undefined,
    taskId: parseOptionalWorkflowId(
      body.taskId,
      "taskId",
      "Task identifier is invalid."
    ),
    projectId: parseOptionalWorkflowId(
      body.projectId,
      "projectId",
      "Project identifier is invalid."
    )
  };
}

export function parseFocusSessionTransitionMutation(value: unknown): {
  action: FocusAction;
  note?: string;
  category?: string;
  taskCompleted?: boolean;
} {
  const body = requireObject(value);
  const action = parseEnum(
    typeof body.action === "string"
      ? body.action.trim().toLowerCase()
      : body.action,
    focusActions,
    "action",
    focusErrors.unknownTimerAction.message
  );

  return {
    action,
    note: parseOptionalText(
      body.note,
      "note",
      "Completion note",
      FOCUS_COMPLETION_NOTE_MAX_LENGTH
    ),
    category: parseOptionalText(
      body.category,
      "category",
      "Completion category",
      FOCUS_CATEGORY_MAX_LENGTH
    ),
    taskCompleted: parseOptionalBoolean(body.taskCompleted, "taskCompleted")
  };
}

export function parseFocusSessionId(
  value: unknown,
  field: string,
  message = focusErrors.focusSessionIdentifierIsInvalid.message
) {
  return parseRecordId(value, field, message, validationError, {
    maximumLength: 191,
    rejectControlCharacters: true
  });
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseOptionalWorkflowId(
  value: unknown,
  field: string,
  message: string
) {
  return parseRecordId(value, field, message, validationError, {
    maximumLength: 191,
    rejectControlCharacters: true,
    nullValues: [undefined, null, ""]
  });
}

function parseOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (value === undefined || value === null) return undefined;
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`,
    trim: true
  });
}

function parseOptionalBoolean(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw validation("Task completion must be true or false.", field);
  }
  return value;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  message: string
) {
  return kernelParseBoundedInteger(
    value, field, minimum, maximum, message, validationError
  );
}

function parseEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  message: string
): Values[number] {
  return kernelParseEnum(value, values, field, message, validationError);
}

function validationError(message: string, field: string) {
  return validation(message, field);
}

/** Persistence-independent lifecycle state; the client DTO keeps ISO strings. */
export type SessionState = {
  id: string;
  kind: FocusSessionKind;
  status: FocusSessionStatus;
  activeKey: number | null;
  startedAt: Date;
  pausedAt: Date | null;
  completedAt: Date | null;
  accumulatedPauseSeconds: number;
  plannedMinutes: number;
  actualMinutes: number;
  needsEnrichment: boolean;
  taskId: string | null;
  projectId: string | null;
  task: { title: string; projectId: string | null } | null;
  label: string;
};

export type SessionEvidence = Pick<SessionState,
  "id" | "startedAt" | "actualMinutes" | "taskId" | "projectId" | "task" | "label">;

export type StartSessionInput = {
  kind?: string;
  plannedMinutes: number;
  label?: string;
  taskId?: string | null;
  projectId?: string | null;
};

export type EnrichmentDetails = { note?: unknown; category?: unknown; taskCompleted?: unknown };

export function elapsedSeconds(
  state: { status: FocusSessionStatus; startedAt: Date | string; pausedAt: Date | string | null; accumulatedPauseSeconds: number },
  now: Date | number
) {
  const end = state.status === "PAUSED" && state.pausedAt ? new Date(state.pausedAt).getTime() : Number(now);
  return Math.max(0, Math.floor((end - new Date(state.startedAt).getTime()) / 1000) - state.accumulatedPauseSeconds);
}

/** A replay emits no new evidence. Persistence claims active state before recording. */
export function transition<T extends SessionState>(state: T, action: string, now: Date): { state: T; evidence: SessionEvidence | null } {
  if (action === "pause") {
    if (state.status !== "RUNNING") throw new AppError(focusErrors.onlyARunningTimerCanBePaused);
    return { state: { ...state, status: "PAUSED", pausedAt: now }, evidence: null };
  }
  if (action === "resume") {
    if (state.status !== "PAUSED" || !state.pausedAt) throw new AppError(focusErrors.onlyAPausedTimerCanBeResumed);
    const pausedSeconds = Math.max(0, Math.floor((now.getTime() - state.pausedAt.getTime()) / 1000));
    return { state: { ...state, status: "RUNNING", pausedAt: null,
      accumulatedPauseSeconds: state.accumulatedPauseSeconds + pausedSeconds }, evidence: null };
  }
  if (action === "complete" && state.status === "COMPLETED") return { state, evidence: null };
  if (action === "complete" || action === "cancel") {
    if (state.status !== "RUNNING" && state.status !== "PAUSED") throw new AppError(focusErrors.thisTimerIsNoLongerActive);
    if (action === "cancel") return { state: { ...state, activeKey: null, status: "CANCELED", completedAt: now, pausedAt: null }, evidence: null };
    const actualMinutes = Math.min(state.plannedMinutes, Math.floor(elapsedSeconds(state, now) / 60));
    const next: T = { ...state, activeKey: null, status: "COMPLETED", completedAt: now, pausedAt: null,
      actualMinutes, needsEnrichment: state.kind === "FOCUS" };
    return { state: next, evidence: state.kind === "FOCUS" && actualMinutes >= 1 ? {
      id: state.id, startedAt: state.startedAt, actualMinutes, taskId: state.taskId,
      projectId: state.projectId, task: state.task, label: state.label
    } : null };
  }
  throw new AppError(focusErrors.unknownTimerAction);
}

export function parseKind(value: unknown): FocusSessionKind {
  const kind = String(value ?? "FOCUS").trim().toUpperCase();
  if (kind === "FOCUS" || kind === "BREAK") return kind;
  throw new AppError(focusErrors.timerKindMustBeFOCUSOrBREAK);
}

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const FocusSessionError = appErrorConstructor((message: string) => validation(message));
export type FocusSessionError = AppError;
export { AppError as FocusSessionConflictError, AppError as FocusSessionNotFoundError };

/** Exact envelopes owned by the focus boundary. The serializer emits exactly the declared properties. */
export const focusErrors = {
  focusSessionIdentifierIsInvalid: {
    status: 400,
    message: "Focus session identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  timerDurationMustBeBetween1And240Minutes: {
    status: 400,
    message: "Timer duration must be between 1 and 240 minutes.",
    code: "VALIDATION_ERROR"
  },
  finishOrCancelTheActiveTimerFirst: {
    status: 409,
    message: "Finish or cancel the active timer first.",
    code: "CONFLICT"
  },
  theSelectedTaskCouldNotBeFound: {
    status: 404,
    message: "The selected task could not be found.",
    code: "NOT_FOUND"
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    message: "The selected task belongs to a different project.",
    code: "CONFLICT"
  },
  theSelectedProjectCouldNotBeFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "NOT_FOUND"
  },
  focusSessionNotFound: {
    status: 404,
    message: "Focus session not found.",
    code: "NOT_FOUND",
    field: "id"
  },
  onlyARunningTimerCanBePaused: {
    status: 409,
    message: "Only a running timer can be paused.",
    code: "CONFLICT"
  },
  onlyAPausedTimerCanBeResumed: {
    status: 409,
    message: "Only a paused timer can be resumed.",
    code: "CONFLICT"
  },
  thisTimerIsNoLongerActive: {
    status: 409,
    message: "This timer is no longer active.",
    code: "CONFLICT"
  },
  onlyACompletedFocusBlockCanBeEnriched: {
    status: 409,
    message: "Only a completed focus block can be enriched.",
    code: "CONFLICT"
  },
  unknownTimerAction: {
    status: 400,
    message: "Unknown timer action.",
    code: "VALIDATION_ERROR"
  },
  timerKindMustBeFOCUSOrBREAK: {
    status: 400,
    message: "Timer kind must be FOCUS or BREAK.",
    code: "VALIDATION_ERROR"
  },
  thisTimerWasUpdatedInAnotherTabRefreshAndTryAgain: {
    status: 409,
    message: "This timer was updated in another tab. Refresh and try again.",
    code: "CONFLICT"
  },
  theFocusSessionChangedBeforeItCouldBeSaved: {
    status: 409,
    message: "The Focus session changed before it could be saved.",
    code: "CONFLICT"
  },
  focusTimerCouldNotBeSaved: {
    status: 500,
    message: "Focus timer could not be saved.",
    code: "INTERNAL_ERROR"
  },
  focusTimerCouldNotBeLoaded: {
    status: 500,
    message: "Focus timer could not be loaded.",
    code: "INTERNAL_ERROR"
  },
  aSelectedFocusRelationshipChangedBeforeTheTimerStarted: {
    status: 409,
    message: "A selected Focus relationship changed before the timer started.",
    code: "CONFLICT"
  },
  focusTimerCouldNotBeStarted: {
    status: 500,
    message: "Focus timer could not be started.",
    code: "INTERNAL_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
