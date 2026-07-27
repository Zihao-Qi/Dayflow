"use client";

import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SaveStateOptions<T> = {
  value: T;
  save: (value: T) => Promise<boolean>;
  normalize?: (value: T) => T;
  isEqual?: (left: T, right: T) => boolean;
  isValid?: (value: T) => boolean;
  onFinalError?: () => void;
  onRecovered?: () => void;
};

const RETRY_DELAYS = [1000, 4000] as const;

export function useSaveState<T>({
  value,
  save,
  normalize = (next) => next,
  isEqual = Object.is,
  isValid = () => true,
  onFinalError,
  onRecovered
}: SaveStateOptions<T>) {
  const [draft, setDraftState] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const latestDraft = useRef(value);
  const persistedValue = useRef(value);
  const stateRef = useRef<SaveState>("idle");
  const saveRef = useRef(save);
  const normalizeRef = useRef(normalize);
  const equalRef = useRef(isEqual);
  const validRef = useRef(isValid);
  const onFinalErrorRef = useRef(onFinalError);
  const onRecoveredRef = useRef(onRecovered);
  const debounceTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  const activeSave = useRef(false);
  const activeValue = useRef(value);
  const queuedSave = useRef(false);
  const mounted = useRef(true);
  const flushRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);

  useEffect(() => {
    saveRef.current = save;
    normalizeRef.current = normalize;
    equalRef.current = isEqual;
    validRef.current = isValid;
    onFinalErrorRef.current = onFinalError;
    onRecoveredRef.current = onRecovered;
  }, [isEqual, isValid, normalize, onFinalError, onRecovered, save]);

  const showState = useCallback((next: SaveState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const clearSavedTimer = useCallback(() => {
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
  }, []);

  const flush = useCallback(
    async (force = false) => {
      clearDebounce();
      const next = normalizeRef.current(latestDraft.current);
      if (!validRef.current(next)) return false;
      if (!force && equalRef.current(next, persistedValue.current)) return true;
      if (activeSave.current) {
        if (!equalRef.current(next, activeValue.current)) queuedSave.current = true;
        return false;
      }

      activeSave.current = true;
      activeValue.current = next;
      clearSavedTimer();
      showState("saving");
      let saved = false;

      for (let attempt = 0; attempt < RETRY_DELAYS.length + 1; attempt += 1) {
        try {
          saved = await saveRef.current(next);
        } catch {
          saved = false;
        }
        if (saved) break;
        if (attempt < RETRY_DELAYS.length) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, RETRY_DELAYS[attempt])
          );
        }
      }

      activeSave.current = false;
      if (!mounted.current) return saved;

      if (saved) {
        persistedValue.current = next;
        setLastSavedAt(Date.now());
        onRecoveredRef.current?.();
        const hasNewerDraft = !equalRef.current(
          normalizeRef.current(latestDraft.current),
          next
        );
        if (hasNewerDraft || queuedSave.current) {
          queuedSave.current = false;
          showState("idle");
          window.setTimeout(() => void flushRef.current(), 0);
        } else {
          showState("saved");
          savedTimer.current = window.setTimeout(() => {
            showState("idle");
            savedTimer.current = null;
          }, 2000);
        }
        return true;
      }

      queuedSave.current = false;
      showState("error");
      onFinalErrorRef.current?.();
      return false;
    },
    [clearDebounce, clearSavedTimer, showState]
  );

  flushRef.current = flush;

  const setDraft = useCallback(
    (next: T) => {
      latestDraft.current = next;
      setDraftState(next);
      clearSavedTimer();
      if (!activeSave.current) showState("idle");
    },
    [clearSavedTimer, showState]
  );

  useEffect(() => {
    const next = normalizeRef.current(draft);
    if (!validRef.current(next) || equalRef.current(next, persistedValue.current)) {
      return;
    }
    clearDebounce();
    debounceTimer.current = window.setTimeout(() => void flushRef.current(), 600);
    return clearDebounce;
  }, [clearDebounce, draft]);

  useEffect(() => {
    if (
      activeSave.current ||
      stateRef.current === "error" ||
      !equalRef.current(
        normalizeRef.current(latestDraft.current),
        persistedValue.current
      )
    ) {
      return;
    }
    persistedValue.current = value;
    latestDraft.current = value;
    setDraftState(value);
  }, [value]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearDebounce();
      clearSavedTimer();
    };
  }, [clearDebounce, clearSavedTimer]);

  function onBlur() {
    void flush();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void flush();
    }
  }

  return {
    draft,
    setDraft,
    state,
    lastSavedAt,
    flush,
    inputProps: { onBlur, onKeyDown }
  };
}

export function SaveStateChip({
  state,
  onRetry,
  className = ""
}: {
  state: SaveState;
  onRetry: () => void;
  className?: string;
}) {
  if (state === "idle") return null;
  return (
    <small className={`save-state-chip ${state} ${className}`.trim()}>
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved"}
      {state === "error" && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </small>
  );
}
