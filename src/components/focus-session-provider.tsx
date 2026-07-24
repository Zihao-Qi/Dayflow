"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  FocusSessionKind,
  FocusSessionRecord,
  FocusSnapshot,
  focusRemainingSeconds
} from "@/lib/focus-domain";

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
  now: number;
  busy: boolean;
  error: string;
  suggestedBreak: number | null;
  notificationState: NotificationPermission | "unsupported";
  activityRevision: number;
  start: (input: FocusStartInput) => Promise<boolean>;
  transition: (action: FocusTransition) => Promise<boolean>;
  dismissBreakSuggestion: () => void;
  requestNotificationPermission: () => Promise<void>;
};

type TransitionResult = {
  completed: boolean;
  suggestedBreakMinutes: number | null;
  snapshot: FocusSnapshot;
  error?: string;
};

const FocusSessionContext = createContext<FocusSessionContextValue | null>(null);

export function FocusSessionProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestedBreak, setSuggestedBreak] = useState<number | null>(null);
  const [notificationState, setNotificationState] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [activityRevision, setActivityRevision] = useState(0);
  const autoFinishingId = useRef<string | null>(null);
  const active = snapshot?.active ?? null;

  useEffect(() => {
    let live = true;
    if ("Notification" in window) setNotificationState(Notification.permission);
    void fetch("/api/focus-session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Focus timer could not be loaded.");
        const result = (await response.json()) as FocusSnapshot;
        if (live) setSnapshot(result);
      })
      .catch((caught: unknown) => {
        if (live) setError(messageFrom(caught));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (active?.status !== "RUNNING") return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active?.id, active?.status]);

  const notifyCompletion = useCallback((session: FocusSessionRecord) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = session.kind === "BREAK" ? "Break complete" : "Focus session complete";
    const body =
      session.kind === "BREAK"
        ? "Ready for the next focused block?"
        : `${session.label} has been recorded.`;
    new Notification(title, { body });
  }, []);

  const transition = useCallback(
    async (action: FocusTransition) => {
      const current = snapshot?.active;
      if (!current || busy) return false;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/focus-session/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        const result = (await response.json()) as TransitionResult;
        if (!response.ok) throw new Error(result.error ?? "The timer could not be updated.");
        setSnapshot(result.snapshot);
        if (action === "complete") {
          notifyCompletion(current);
          setSuggestedBreak(result.suggestedBreakMinutes);
          if (current.kind === "FOCUS") {
            setActivityRevision((revision) => revision + 1);
          }
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
        const response = await fetch("/api/focus-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            kind: input.kind ?? "FOCUS",
            plannedMinutes: minutes
          })
        });
        const result = (await response.json()) as {
          snapshot?: FocusSnapshot;
          error?: string;
        };
        if (!response.ok || !result.snapshot) {
          throw new Error(result.error ?? "The timer could not be started.");
        }
        setSnapshot(result.snapshot);
        setSuggestedBreak(null);
        setNow(Date.now());
        return true;
      } catch (caught) {
        setError(messageFrom(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotificationState(await Notification.requestPermission());
  }, []);

  const value = useMemo<FocusSessionContextValue>(
    () => ({
      snapshot,
      active,
      now,
      busy,
      error,
      suggestedBreak,
      notificationState,
      activityRevision,
      start,
      transition,
      dismissBreakSuggestion: () => setSuggestedBreak(null),
      requestNotificationPermission
    }),
    [
      snapshot,
      active,
      now,
      busy,
      error,
      suggestedBreak,
      notificationState,
      activityRevision,
      start,
      transition,
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

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
