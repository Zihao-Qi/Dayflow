"use client";

import {
  enrichFocus as enrichFocusRequest,
  loadFocus as loadFocusRequest,
  startFocus as startFocusRequest,
  transitionFocus as transitionFocusRequest
} from "@/modules/focus/ui/api";
import {
  FocusSessionKind,
  FocusSessionRecord,
  FocusSnapshot,
  focusRemainingSeconds
} from "@/lib/focus-domain";
import { prepareFocusStartAttempt, type FocusStartAttempt } from "@/lib/focus-start-idempotency";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type FocusStartInput = {
  kind?: FocusSessionKind;
  plannedMinutes: number;
  label?: string;
  taskId?: string | null;
  projectId?: string | null;
};

type FocusTransition = "pause" | "resume" | "complete" | "cancel";

type FocusSessionContextValue = {
  snapshot: FocusSnapshot | null;
  active: FocusSessionRecord | null;
  pendingCompletion: FocusSessionRecord | null;
  now: number;
  busy: boolean;
  error: string;
  suggestedBreak: number | null;
  retryNext: FocusStartInput | null;
  notificationState: NotificationPermission | "unsupported";
  activityRevision: number;
  start: (input: FocusStartInput) => Promise<boolean>;
  transition: (action: FocusTransition) => Promise<boolean>;
  enrichCompletion: (input: {
    note: string;
    category: string;
    taskCompleted: boolean;
    next: FocusStartInput | null;
  }) => Promise<boolean>;
  retryNextStart: () => Promise<boolean>;
  reload: () => Promise<boolean>;
  dismissBreakSuggestion: () => void;
  requestNotificationPermission: () => Promise<void>;
};

const FocusSessionContext = createContext<FocusSessionContextValue | null>(null);
const retryNextStorageKey = "dayflow-focus-retry-next";

export function FocusSessionProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestedBreak, setSuggestedBreak] = useState<number | null>(null);
  const [retryNext, setRetryNext] = useState<FocusStartInput | null>(null);
  const [notificationState, setNotificationState] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  // Notify the shell after every confirmed Focus write, including writes that
  // only change the timer or consume a queue item rather than create evidence.
  const [activityRevision, setActivityRevision] = useState(0);
  const autoFinishingId = useRef<string | null>(null);
  const startAttempt = useRef<FocusStartAttempt | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const active = snapshot?.active ?? null;
  const pendingCompletion = snapshot?.pendingCompletion ?? null;
  const rememberRetryNext = useCallback((next: FocusStartInput | null) => {
    setRetryNext(next);
    if (next) {
      window.sessionStorage.setItem(retryNextStorageKey, JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(retryNextStorageKey);
    }
  }, []);

  const reload = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError("");
    try {
      const result = await loadFocusRequest(controller.signal);

      if (loadController.current !== controller) return false;
      setSnapshot(result);
      if (result.active || result.pendingCompletion) {
        rememberRetryNext(null);
      }
      return true;
    } catch (caught: unknown) {
      if (controller.signal.aborted) return false;
      setError(messageFrom(caught));
      return false;
    } finally {
      if (loadController.current === controller) loadController.current = null;
    }
  }, [rememberRetryNext]);

  useEffect(() => {
    setRetryNext(readStoredRetryNext());
    if ("Notification" in window) setNotificationState(Notification.permission);
    void reload();
    return () => loadController.current?.abort();
  }, [reload]);

  useEffect(() => {
    if (active?.status !== "RUNNING" && active?.status !== "PAUSED") return;
    setNow(Date.now());
    const interval = window.setInterval(
      () => setNow(Date.now()),
      active.status === "RUNNING" ? 1000 : 30_000
    );
    return () => window.clearInterval(interval);
  }, [active?.id, active?.status]);

  const notifyCompletion = useCallback((session: FocusSessionRecord) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = session.kind === "BREAK" ? "Break complete" : "Focus session complete";
    const body =
      session.kind === "BREAK"
        ? "Ready for the next focus session?"
        : `${session.label} is complete. Add details whenever you are ready.`;
    new Notification(title, { body });
  }, []);

  const transition = useCallback(
    async (action: FocusTransition) => {
      const current = snapshot?.active;
      if (!current || busy) return false;
      setBusy(true);
      setError("");
      try {
        const result = await transitionFocusRequest(current.id, action);

        setSnapshot(result.snapshot);
        setActivityRevision((revision) => revision + 1);
        if (action === "complete") {
          notifyCompletion(current);
          setSuggestedBreak(result.suggestedBreakMinutes);
        } else if (action === "cancel") {
          setSuggestedBreak(null);
        }
        return true;
      } catch (caught) {
        setError(messageFrom(caught));
        return false;
      } finally {
        autoFinishingId.current = null;
        setBusy(false);
      }
    },
    [busy, notifyCompletion, snapshot]
  );

  const remainingSeconds = active ? focusRemainingSeconds(active, now) : 0;

  useEffect(() => {
    if (
      !active ||
      active.status !== "RUNNING" ||
      remainingSeconds > 0 ||
      autoFinishingId.current === active.id
    ) {
      return;
    }
    autoFinishingId.current = active.id;
    void transition("complete");
  }, [active, remainingSeconds, transition]);

  const start = useCallback(
    async (input: FocusStartInput) => {
      if (busy) return false;
      const minutes = Math.round(Number(input.plannedMinutes));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
        setError("Choose a duration between 1 and 240 minutes.");
        return false;
      }

      setBusy(true);
      setError("");
      try {
        const attempt = prepareFocusStartAttempt(startAttempt.current, {
          ...input,
          plannedMinutes: minutes
        });
        startAttempt.current = attempt;
        const result = await startFocusRequest(attempt);

        startAttempt.current = null;
        setSnapshot(result.snapshot);
        setSuggestedBreak(null);
        rememberRetryNext(null);
        setNow(Date.now());
        setActivityRevision((revision) => revision + 1);
        return true;
      } catch (caught) {
        setError(messageFrom(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, rememberRetryNext]
  );

  const enrichCompletion = useCallback(
    async (input: {
      note: string;
      category: string;
      taskCompleted: boolean;
      next: FocusStartInput | null;
    }) => {
      const completion = snapshot?.pendingCompletion;
      if (!completion || busy) return false;
      setBusy(true);
      setError("");
      try {
        const result = await enrichFocusRequest(completion.id, input);

        setSnapshot(result.snapshot);
        setSuggestedBreak(null);
        rememberRetryNext(null);
        setNow(Date.now());
        setActivityRevision((revision) => revision + 1);
        let nextSnapshot = result.snapshot;
        if (input.next) {
          rememberRetryNext(input.next);
          const attempt = prepareFocusStartAttempt(
            startAttempt.current,
            input.next
          );
          startAttempt.current = attempt;
          const nextResult = await startFocusRequest(attempt, "The next queue item could not be started.");
          // Enrichment's refresh may already have finished before this write.
          setActivityRevision((revision) => revision + 1);
          nextSnapshot = nextResult.snapshot;
          startAttempt.current = null;
          rememberRetryNext(null);
        }
        setSnapshot(nextSnapshot);
        return true;
      } catch (caught) {
        setError(messageFrom(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, rememberRetryNext, snapshot]
  );

  const retryNextStart = useCallback(async () => {
    if (!retryNext) return false;
    return start(retryNext);
  }, [retryNext, start]);

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotificationState(await Notification.requestPermission());
  }, []);

  const value = useMemo<FocusSessionContextValue>(
    () => ({
      snapshot,
      active,
      pendingCompletion,
      now,
      busy,
      error,
      suggestedBreak,
      retryNext,
      notificationState,
      activityRevision,
      start,
      transition,
      enrichCompletion,
      retryNextStart,
      reload,
      dismissBreakSuggestion: () => setSuggestedBreak(null),
      requestNotificationPermission
    }),
    [
      snapshot,
      active,
      pendingCompletion,
      now,
      busy,
      error,
      suggestedBreak,
      retryNext,
      notificationState,
      activityRevision,
      start,
      transition,
      enrichCompletion,
      retryNextStart,
      reload,
      requestNotificationPermission
    ]
  );

  return (
    <FocusSessionContext.Provider value={value}>
      {children}
    </FocusSessionContext.Provider>
  );
}

export function useFocusSession() {
  const value = useContext(FocusSessionContext);
  if (!value) throw new Error("useFocusSession must be used inside FocusSessionProvider.");
  return value;
}

function readStoredRetryNext(): FocusStartInput | null {
  try {
    const raw = window.sessionStorage.getItem(retryNextStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FocusStartInput>;
    const plannedMinutes = Number(value.plannedMinutes);
    if (
      !Number.isInteger(plannedMinutes) ||
      plannedMinutes < 1 ||
      plannedMinutes > 240 ||
      (value.kind !== undefined &&
        value.kind !== "FOCUS" &&
        value.kind !== "BREAK")
    ) {
      window.sessionStorage.removeItem(retryNextStorageKey);
      return null;
    }
    return {
      kind: value.kind,
      plannedMinutes,
      label: typeof value.label === "string" ? value.label : undefined,
      taskId:
        typeof value.taskId === "string" || value.taskId === null
          ? value.taskId
          : undefined,
      projectId:
        typeof value.projectId === "string" || value.projectId === null
          ? value.projectId
          : undefined
    };
  } catch {
    window.sessionStorage.removeItem(retryNextStorageKey);
    return null;
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
