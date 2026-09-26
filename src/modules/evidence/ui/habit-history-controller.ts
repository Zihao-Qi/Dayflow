import { localDateKey, parseLocalDate } from "@/shared/kernel/calendar";
import type {
  HabitCheckInReconciliation,
  HabitHistoryCheckIn,
  HabitHistoryPayload
} from "./history-api";

export type HabitHistoryDraft = {
  done: boolean | null;
  amount: string;
  note: string;
  touchedAmount: boolean;
  touchedNote: boolean;
};

export type PendingIntention = {
  mutationId: string;
  fingerprint: string;
  isUncertain: boolean;
  isSaving: boolean;
};

export type HistoryFieldError = { message: string; field?: string };

export type CheckInAttempt = {
  date: string;
  done: boolean;
  amount?: number | null;
  note?: string | null;
};

type RowGuard = { startedAt: number; row: HabitHistoryCheckIn };
type RecordRead = { startedAt: number; row: HabitHistoryCheckIn | null };

export type HistorySession = {
  selectedDate: string;
  history: HabitHistoryPayload | null;
  loading: boolean;
  loadError: string | null;
  refreshError: string | null;
  drafts: Map<string, HabitHistoryDraft>;
  errors: Map<string, HistoryFieldError>;
  editingHabitId: string | null;
  pending: Map<string, PendingIntention>;
  holds: Set<string>;
  guards: Map<string, RowGuard>;
  recordReads: Map<string, RecordRead>;
  intentionStart: Map<string, number>;
  /** Set when a replay was acknowledged and must not be painted until a later read. */
  receiptAwaitingRead: boolean;
  /** startedAt of the read that last owned the eight-day window fields. */
  windowAsOf: number;
  issue: number;
  readGeneration: number;
  latestAppliedReadStart: number;
};

export const CLOSED_DAY_MESSAGE =
  "This day has closed. The saved attempt keeps its original date.";
export const UNCONFIRMED_CHANGE_MESSAGE =
  "This saved attempt is still unconfirmed. Check status before changing it.";
export const SAVE_IN_FLIGHT_MESSAGE = "Another check-in save is still finishing.";
export const NEWER_READ_MESSAGE =
  "A newer history read is on screen. The saved attempt was not applied over it.";
export const RECONCILE_MISMATCH_MESSAGE =
  "This date does not match the saved attempt. The attempt is still unconfirmed.";
export const REFRESH_FAILURE_MESSAGE =
  "History could not be refreshed. Confirmed check-ins already on screen stay put.";
export const ACKNOWLEDGED_REFRESH_MESSAGE =
  "The save was acknowledged. The on-screen record stays until a current read finishes.";
export const ACKNOWLEDGED_REFRESH_FAILURE =
  "The save was acknowledged, but the current record could not be refreshed. The on-screen record was left in place.";
export const SAVED_ANNOUNCEMENT = "Saved check-in.";
export const MATCHED_ANNOUNCEMENT = "Saved check-in is the current record.";

export function createHistorySession(selectedDate = ""): HistorySession {
  return {
    selectedDate,
    history: null,
    loading: false,
    loadError: null,
    refreshError: null,
    drafts: new Map(),
    errors: new Map(),
    editingHabitId: null,
    pending: new Map(),
    holds: new Set(),
    guards: new Map(),
    recordReads: new Map(),
    intentionStart: new Map(),
    receiptAwaitingRead: false,
    windowAsOf: 0,
    issue: 0,
    readGeneration: 0,
    latestAppliedReadStart: 0
  };
}

export function historyRecordKey(habitId: string, date: string) {
  return `${habitId}:${date}`;
}

export function readHistoryRecordKey(key: string): { habitId: string; date: string } | null {
  const date = key.slice(-10);
  if (key.length < 12 || key[key.length - 11] !== ":") return null;
  const parsed = parseLocalDate(date);
  if (!parsed || localDateKey(parsed) !== date) return null;
  const habitId = key.slice(0, -11);
  if (!habitId) return null;
  return { habitId, date };
}

export function historyDayRefresh(previous: string | undefined, next: string | undefined) {
  return Boolean(previous && next && previous !== next);
}

export function historyForegroundRefresh(isOpen: boolean, visibility: string) {
  return isOpen && visibility === "visible";
}

export function attemptFingerprint(body: CheckInAttempt) {
  const fields: Record<string, unknown> = { date: body.date, done: body.done };
  if ("amount" in body) fields.amount = body.amount;
  if ("note" in body) fields.note = body.note;
  return JSON.stringify(fields);
}

export function evidenceMatchesAttempt(
  row: HabitHistoryCheckIn | null | undefined,
  attempt: CheckInAttempt,
  habitId: string
) {
  if (!row || row.habitId !== habitId || row.day !== attempt.date || row.done !== attempt.done) {
    return false;
  }
  if ("amount" in attempt && row.amount !== attempt.amount) return false;
  if ("note" in attempt && row.note !== attempt.note) return false;
  return true;
}

function parseAttempt(fingerprint: string): CheckInAttempt | null {
  try {
    const value = JSON.parse(fingerprint) as CheckInAttempt;
    if (!value || typeof value.date !== "string" || typeof value.done !== "boolean") return null;
    return value;
  } catch {
    return null;
  }
}

function findCheckIn(history: HabitHistoryPayload | null, habitId: string, date: string) {
  return history?.checkIns.find((row) => row.habitId === habitId && row.day === date);
}

function replaceCheckIn(
  history: HabitHistoryPayload,
  habitId: string,
  date: string,
  row: HabitHistoryCheckIn | null
) {
  const checkIns = history.checkIns.filter((item) => !(item.habitId === habitId && item.day === date));
  if (row) checkIns.push(row);
  return { ...history, checkIns };
}

function withError(session: HistorySession, key: string, error: HistoryFieldError) {
  const errors = new Map(session.errors);
  errors.set(key, error);
  return { ...session, errors };
}

function withoutError(session: HistorySession, key: string) {
  if (!session.errors.has(key)) return session;
  const errors = new Map(session.errors);
  errors.delete(key);
  return { ...session, errors };
}

export function materializeDraft(session: HistorySession, habitId: string, date: string): HabitHistoryDraft {
  const existing = session.drafts.get(historyRecordKey(habitId, date));
  if (existing) return existing;
  const checkIn = findCheckIn(session.history, habitId, date);
  return {
    done: checkIn ? checkIn.done : null,
    amount: checkIn?.amount !== null && checkIn?.amount !== undefined ? String(checkIn.amount) : "",
    note: checkIn?.note ?? "",
    touchedAmount: false,
    touchedNote: false
  };
}

export function draftIsDirty(session: HistorySession, habitId: string, date: string, draft: HabitHistoryDraft) {
  const existing = findCheckIn(session.history, habitId, date);
  if (draft.touchedAmount || draft.touchedNote) return true;
  if (draft.done === null) return false;
  if (!existing) return true;
  return existing.done !== draft.done;
}

export function hasDiscardableDrafts(session: HistorySession) {
  for (const [key, draft] of session.drafts) {
    const pending = session.pending.get(key);
    if (pending?.isUncertain || pending?.isSaving || session.holds.has(key)) continue;
    const parsed = readHistoryRecordKey(key);
    if (!parsed) continue;
    if (draftIsDirty(session, parsed.habitId, parsed.date, draft)) return true;
  }
  return false;
}

export function selectHistoryDate(session: HistorySession, date: string): HistorySession {
  if (session.selectedDate === date) return session;
  return { ...session, selectedDate: date };
}

export function updateHistoryDraft(
  session: HistorySession,
  habitId: string,
  date: string,
  updater: Partial<HabitHistoryDraft> | ((prev: HabitHistoryDraft) => HabitHistoryDraft)
): HistorySession {
  const key = historyRecordKey(habitId, date);
  const pending = session.pending.get(key);
  if (pending?.isUncertain || pending?.isSaving || session.holds.has(key)) return session;
  const current = materializeDraft(session, habitId, date);
  const updated = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  const drafts = new Map(session.drafts);
  drafts.set(key, updated);
  return { ...session, drafts };
}

export function clearHistoryDraft(session: HistorySession, habitId: string, date: string): HistorySession {
  const key = historyRecordKey(habitId, date);
  const pending = session.pending.get(key);
  if (pending?.isUncertain || pending?.isSaving || session.holds.has(key)) return session;
  if (!session.drafts.has(key) && !session.errors.has(key)) return session;
  const drafts = new Map(session.drafts);
  drafts.delete(key);
  const errors = new Map(session.errors);
  errors.delete(key);
  return { ...session, drafts, errors };
}

export function discardUnsentHistoryEdits(session: HistorySession): HistorySession {
  const drafts = new Map(session.drafts);
  const errors = new Map(session.errors);
  for (const key of drafts.keys()) {
    const pending = session.pending.get(key);
    if (pending?.isUncertain || pending?.isSaving || session.holds.has(key)) continue;
    drafts.delete(key);
    errors.delete(key);
  }
  return { ...session, drafts, errors, editingHabitId: null };
}

export function setHistoryEditor(session: HistorySession, habitId: string | null): HistorySession {
  if (session.editingHabitId === habitId) return session;
  return { ...session, editingHabitId: habitId };
}

export function draftToAttempt(
  date: string,
  draft: HabitHistoryDraft
): { ok: true; body: CheckInAttempt } | { ok: false; error: string; field?: string } {
  if (draft.done === null) {
    return { ok: false, error: "Please mark Done or Not done before saving." };
  }
  const body: CheckInAttempt = { date, done: draft.done };
  if (draft.touchedAmount) {
    const trimmed = draft.amount.trim();
    if (trimmed === "") body.amount = null;
    else {
      const amount = Number(trimmed);
      if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000) {
        return {
          ok: false,
          field: "amount",
          error: "Check-in amount must be a whole number between 0 and 1,000,000."
        };
      }
      body.amount = amount;
    }
  }
  if (draft.touchedNote) {
    if (draft.note.length > 2_000) {
      return { ok: false, field: "note", error: "Check-in note must be 2,000 characters or fewer." };
    }
    body.note = draft.note === "" ? null : draft.note;
  }
  return { ok: true, body };
}

function tick(session: HistorySession) {
  const startedAt = session.issue + 1;
  return { session: { ...session, issue: startedAt }, startedAt };
}

export function beginHistoryLoad(session: HistorySession) {
  const next = tick(session);
  const generation = session.readGeneration + 1;
  return {
    startedAt: next.startedAt,
    generation,
    session: {
      ...next.session,
      readGeneration: generation,
      loading: session.history === null ? true : session.loading
    }
  };
}

function overlayGuards(session: HistorySession, checkIns: HabitHistoryCheckIn[], readStartedAt: number) {
  const owned = new Map<string, { startedAt: number; row: HabitHistoryCheckIn | null }>();
  for (const [key, guard] of session.guards) {
    if (guard.startedAt > readStartedAt) owned.set(key, guard);
  }
  for (const [key, read] of session.recordReads) {
    if (read.startedAt <= readStartedAt) continue;
    const current = owned.get(key);
    if (!current || read.startedAt > current.startedAt) owned.set(key, read);
  }
  let next = checkIns.slice();
  for (const [key, item] of owned) {
    const parsed = readHistoryRecordKey(key);
    if (!parsed) continue;
    next = next.filter((row) => !(row.habitId === parsed.habitId && row.day === parsed.date));
    if (item.row) next.push(item.row);
  }
  return next;
}

function pruneStarted<T extends { startedAt: number }>(rows: Map<string, T>, readStartedAt: number) {
  const next = new Map(rows);
  for (const [key, row] of rows) {
    if (row.startedAt <= readStartedAt) next.delete(key);
  }
  return next;
}

export function settleHistoryLoad(
  session: HistorySession,
  generation: number,
  startedAt: number,
  outcome: { ok: true; data: HabitHistoryPayload } | { ok: false; message: string }
) {
  if (generation !== session.readGeneration) return { session, applied: false as const };
  if (!outcome.ok) {
    const refreshing = session.history !== null;
    return {
      applied: true as const,
      session: {
        ...session,
        loading: false,
        receiptAwaitingRead: false,
        loadError: refreshing ? session.loadError : outcome.message,
        refreshError: refreshing
          ? (session.receiptAwaitingRead ? ACKNOWLEDGED_REFRESH_FAILURE : REFRESH_FAILURE_MESSAGE)
          : session.refreshError
      }
    };
  }
  let history = {
    ...outcome.data,
    checkIns: overlayGuards(session, outcome.data.checkIns, startedAt)
  };
  if (session.windowAsOf > startedAt && session.history) {
    history = {
      ...history,
      todayKey: session.history.todayKey,
      earliestDate: session.history.earliestDate,
      latestDate: session.history.latestDate
    };
  }
  return {
    applied: true as const,
    session: {
      ...session,
      history,
      guards: pruneStarted(session.guards, startedAt),
      recordReads: pruneStarted(session.recordReads, startedAt),
      selectedDate: session.selectedDate || outcome.data.todayKey,
      loading: false,
      loadError: null,
      refreshError: null,
      receiptAwaitingRead: false,
      windowAsOf: Math.max(session.windowAsOf, startedAt),
      latestAppliedReadStart: Math.max(session.latestAppliedReadStart, startedAt)
    }
  };
}

export function beginCheckInSave(
  session: HistorySession,
  input: { habitId: string; date: string; draft: HabitHistoryDraft; createId: () => string }
) {
  const key = historyRecordKey(input.habitId, input.date);
  if ([...session.pending.values()].some((item) => item.isSaving)) {
    return { ok: false as const, session, error: SAVE_IN_FLIGHT_MESSAGE };
  }
  const parsed = draftToAttempt(input.date, input.draft);
  if (!parsed.ok) {
    return {
      ok: false as const,
      session: withError(session, key, { message: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) }),
      error: parsed.error
    };
  }
  if (
    session.history &&
    (input.date < session.history.earliestDate || input.date > session.history.latestDate)
  ) {
    const error = { message: CLOSED_DAY_MESSAGE, field: "date" as const };
    return { ok: false as const, session: withError(session, key, error), error: CLOSED_DAY_MESSAGE };
  }
  const fingerprint = attemptFingerprint(parsed.body);
  const current = session.pending.get(key);
  const retained = Boolean(current?.isUncertain || session.holds.has(key));
  if (retained && current && current.fingerprint !== fingerprint) {
    return { ok: false as const, session, error: UNCONFIRMED_CHANGE_MESSAGE };
  }
  const next = tick(session);
  const mutationId = retained && current ? current.mutationId : input.createId();
  const pending = new Map(session.pending);
  pending.set(key, { mutationId, fingerprint, isUncertain: retained, isSaving: true });
  const holds = new Set(session.holds);
  if (retained) holds.add(key);
  const intentionStart = new Map(session.intentionStart);
  intentionStart.set(key, next.startedAt);
  return {
    ok: true as const,
    session: { ...next.session, pending, holds, intentionStart },
    body: parsed.body,
    mutationId,
    fingerprint,
    startedAt: next.startedAt,
    retainedUncertainty: retained
  };
}

function dropResolved(session: HistorySession, key: string, habitId: string, date: string) {
  const pending = new Map(session.pending);
  pending.delete(key);
  const holds = new Set(session.holds);
  holds.delete(key);
  const intentionStart = new Map(session.intentionStart);
  intentionStart.delete(key);
  const drafts = new Map(session.drafts);
  const stored = drafts.get(key);
  if (!stored || attemptFingerprint(draftBodyOrStored(date, stored)) === session.pending.get(key)?.fingerprint) {
    drafts.delete(key);
  }
  const editingHabitId =
    session.editingHabitId === habitId && session.selectedDate === date ? null : session.editingHabitId;
  return withoutError({ ...session, pending, holds, drafts, editingHabitId, intentionStart }, key);
}

function draftBodyOrStored(date: string, draft: HabitHistoryDraft): CheckInAttempt {
  const parsed = draftToAttempt(date, draft);
  return parsed.ok ? parsed.body : { date, done: draft.done ?? false };
}

export function settleCheckInSave(
  session: HistorySession,
  input: {
    habitId: string;
    date: string;
    mutationId: string;
    startedAt: number;
    outcome:
      | { type: "success"; checkIn: HabitHistoryCheckIn }
      | { type: "failure"; status?: number; message: string; field?: string };
  }
) {
  const key = historyRecordKey(input.habitId, input.date);
  const pending = session.pending.get(key);
  if (!pending || pending.mutationId !== input.mutationId || !pending.isSaving) {
    return {
      session,
      shellRefresh: false,
      refreshHistory: false,
      announcement: null as string | null,
      result: { ok: false as const, error: "This save is no longer the current attempt." }
    };
  }
  const attempt = parseAttempt(pending.fingerprint);
  if (input.outcome.type === "failure") {
    const keep = input.outcome.status !== 400 || session.holds.has(key);
    const nextPending = new Map(session.pending);
    nextPending.set(key, { ...pending, isSaving: false, isUncertain: keep });
    const holds = new Set(session.holds);
    if (keep) holds.add(key);
    else holds.delete(key);
    return {
      session: withError(
        { ...session, pending: nextPending, holds },
        key,
        { message: input.outcome.message, ...(input.outcome.field ? { field: input.outcome.field } : {}) }
      ),
      shellRefresh: false,
      refreshHistory: false,
      announcement: null,
      result: { ok: false as const, error: input.outcome.message }
    };
  }
  const published: HabitHistoryCheckIn = {
    ...input.outcome.checkIn,
    habitId: input.habitId,
    day: input.date
  };
  // A retained retry's success is the original receipt, not proof of what is current now.
  if (pending.isUncertain || session.holds.has(key)) {
    return {
      session: { ...dropResolved(session, key, input.habitId, input.date), receiptAwaitingRead: true },
      shellRefresh: true,
      refreshHistory: true,
      announcement: ACKNOWLEDGED_REFRESH_MESSAGE,
      result: { ok: true as const }
    };
  }
  const recordRead = session.recordReads.get(key);
  const newerRead = session.latestAppliedReadStart > input.startedAt ||
    (recordRead !== undefined && recordRead.startedAt > input.startedAt);
  if (newerRead) {
    const current = findCheckIn(session.history, input.habitId, input.date);
    if (attempt && evidenceMatchesAttempt(current, attempt, input.habitId)) {
      return {
        session: dropResolved(session, key, input.habitId, input.date),
        shellRefresh: true,
        refreshHistory: false,
        announcement: MATCHED_ANNOUNCEMENT,
        result: { ok: true as const }
      };
    }
    const nextPending = new Map(session.pending);
    nextPending.set(key, { ...pending, isSaving: false, isUncertain: true });
    const holds = new Set(session.holds);
    holds.add(key);
    return {
      session: withError(
        { ...session, pending: nextPending, holds },
        key,
        { message: NEWER_READ_MESSAGE }
      ),
      shellRefresh: false,
      refreshHistory: false,
      announcement: null,
      result: { ok: false as const, error: NEWER_READ_MESSAGE }
    };
  }
  const guards = new Map(session.guards);
  guards.set(key, { startedAt: input.startedAt, row: published });
  const history = session.history
    ? replaceCheckIn(session.history, input.habitId, input.date, published)
    : session.history;
  return {
    session: dropResolved({ ...session, history, guards }, key, input.habitId, input.date),
    shellRefresh: true,
    refreshHistory: true,
    announcement: SAVED_ANNOUNCEMENT,
    result: { ok: true as const }
  };
}

export function beginReconcile(session: HistorySession) {
  return tick(session);
}

function readOwnsRecord(session: HistorySession, key: string, startedAt: number) {
  const guard = session.guards.get(key);
  const prior = session.recordReads.get(key);
  return (guard !== undefined && guard.startedAt > startedAt) ||
    (prior !== undefined && prior.startedAt > startedAt) ||
    session.latestAppliedReadStart > startedAt;
}

function applyExactRead(
  session: HistorySession,
  key: string,
  habitId: string,
  date: string,
  startedAt: number,
  result: HabitCheckInReconciliation
) {
  if (readOwnsRecord(session, key, startedAt)) return session;
  const recordReads = new Map(session.recordReads);
  recordReads.set(key, { startedAt, row: result.checkIn });
  let history = session.history;
  let windowAsOf = session.windowAsOf;
  if (history) {
    if (startedAt > session.windowAsOf) {
      history = {
        ...history,
        todayKey: result.todayKey,
        earliestDate: result.earliestDate,
        latestDate: result.latestDate
      };
      windowAsOf = startedAt;
    }
    history = replaceCheckIn(history, habitId, date, result.checkIn);
  }
  return { ...session, history, recordReads, windowAsOf };
}

export function settleReconcile(
  session: HistorySession,
  input: {
    habitId: string;
    date: string;
    startedAt: number;
    outcome: { ok: true; result: HabitCheckInReconciliation } | { ok: false; message: string };
  }
) {
  const key = historyRecordKey(input.habitId, input.date);
  const pending = session.pending.get(key);
  const intentionAt = session.intentionStart.get(key);
  const olderThanIntention = pending !== undefined && intentionAt !== undefined && input.startedAt < intentionAt;
  const untouched = { session, shellRefresh: false, announcement: null as string | null };
  if (!input.outcome.ok) {
    if (olderThanIntention || pending?.isSaving || readOwnsRecord(session, key, input.startedAt)) {
      return untouched;
    }
    return {
      session: withError(session, key, { message: input.outcome.message }),
      shellRefresh: false,
      announcement: null
    };
  }
  if (olderThanIntention) return untouched;
  const next = applyExactRead(
    session,
    key,
    input.habitId,
    input.date,
    input.startedAt,
    input.outcome.result
  );
  if (next === session) return untouched;
  if (pending?.isSaving) return { session: next, shellRefresh: false, announcement: null };
  const attempt = pending ? parseAttempt(pending.fingerprint) : null;
  const matches = attempt
    ? evidenceMatchesAttempt(input.outcome.result.checkIn, attempt, input.habitId)
    : false;
  if (pending && matches && input.outcome.result.checkIn) {
    return {
      session: dropResolved(next, key, input.habitId, input.date),
      shellRefresh: true,
      announcement: MATCHED_ANNOUNCEMENT
    };
  }
  if (pending) {
    return {
      session: withError(
        {
          ...next,
          pending: new Map(next.pending).set(key, { ...pending, isSaving: false, isUncertain: true }),
          holds: new Set(next.holds).add(key)
        },
        key,
        { message: RECONCILE_MISMATCH_MESSAGE }
      ),
      shellRefresh: false,
      announcement: null
    };
  }
  return { session: next, shellRefresh: false, announcement: null };
}
