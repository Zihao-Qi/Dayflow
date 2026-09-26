"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHabitCheckInDate,
  fetchHabitHistory,
  type HabitCheckInReconciliation,
  type HabitHistoryCheckIn,
  type HabitHistoryDefinition,
  type HabitHistoryPayload
} from "./history-api";
import { recordCheckIn } from "./api";
import { addDays, localDateKey, parseLocalDate } from "@/shared/kernel/calendar";
import { ApiError } from "@/shared/client/api-client";

export type HabitHistoryDayState = "done" | "notDone" | "unrecorded" | "outOfScope";

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

export type UseHabitHistoryOptions = {
  initialTodayKey?: string;
  refreshAfterConfirmedMutation?: () => Promise<boolean>;
  setAppAnnouncement?: (message: string) => void;
  setAppError?: (message: string) => void;
};

export function computeDayState(
  habit: HabitHistoryDefinition,
  dayKey: string,
  checkIn: HabitHistoryCheckIn | undefined
): HabitHistoryDayState {
  if (checkIn) {
    return checkIn.done ? "done" : "notDone";
  }
  if (dayKey < habit.createdDay) {
    return "outOfScope";
  }
  if (habit.archivedDay !== null && dayKey > habit.archivedDay) {
    return "outOfScope";
  }
  return "unrecorded";
}

export function generateDateRange(earliestDate: string, latestDate: string): string[] {
  const dates: string[] = [];
  const start = parseLocalDate(earliestDate);
  const end = parseLocalDate(latestDate);
  if (!start || !end) return [earliestDate];
  let current = start;
  while (current.getTime() <= end.getTime()) {
    dates.push(localDateKey(current));
    current = addDays(current, 1);
  }
  return dates;
}

export function useHabitHistory({
  initialTodayKey,
  refreshAfterConfirmedMutation,
  setAppAnnouncement,
  setAppError
}: UseHabitHistoryOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => initialTodayKey ?? "");
  const [historyData, setHistoryData] = useState<HabitHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Keyed drafts and errors: key is `${habitId}:${date}`
  const [drafts, setDrafts] = useState<Map<string, HabitHistoryDraft>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, { message: string; field?: string }>>(() => new Map());
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Pending intentions: key is `${habitId}:${date}`
  const pendingMutations = useRef<Map<string, PendingIntention>>(new Map());
  const readGenerationRef = useRef(0);

  // Sync selectedDate with initialTodayKey if not yet set
  useEffect(() => {
    if (!selectedDate && initialTodayKey) {
      setSelectedDate(initialTodayKey);
    }
  }, [initialTodayKey, selectedDate]);

  const loadHistory = useCallback(async (isInitial = false) => {
    const generation = ++readGenerationRef.current;
    if (isInitial) setLoading(true);
    setLoadError(null);
    setRefreshError(null);
    try {
      const data = await fetchHabitHistory();
      if (generation !== readGenerationRef.current) return false;
      setHistoryData(data);
      if (!selectedDate || selectedDate > data.latestDate || selectedDate < data.earliestDate) {
        setSelectedDate(data.todayKey);
      }
      return true;
    } catch (error) {
      if (generation !== readGenerationRef.current) return false;
      const message = error instanceof Error ? error.message : "Habit history could not be loaded.";
      if (isInitial) {
        setLoadError(message);
      } else {
        setRefreshError(message);
      }
      return false;
    } finally {
      if (isInitial && generation === readGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [selectedDate]);

  const openHistory = useCallback(() => {
    setIsOpen(true);
    setShowDiscardConfirm(false);
    void loadHistory(true);
  }, [loadHistory]);

  const dates = useMemo(() => {
    if (historyData) {
      return generateDateRange(historyData.earliestDate, historyData.latestDate);
    }
    if (initialTodayKey) {
      const today = parseLocalDate(initialTodayKey);
      if (today) {
        return generateDateRange(localDateKey(addDays(today, -7)), initialTodayKey);
      }
    }
    return [];
  }, [historyData, initialTodayKey]);

  // Check whether any draft is dirty compared to current evidence
  const isDraftDirty = useCallback((habitId: string, date: string, draft: HabitHistoryDraft): boolean => {
    const existingCheckIn = historyData?.checkIns.find(
      (c) => c.habitId === habitId && c.day === date
    );
    if (draft.touchedAmount || draft.touchedNote) return true;
    if (draft.done !== null) {
      if (!existingCheckIn) return true;
      if (existingCheckIn.done !== draft.done) return true;
    }
    return false;
  }, [historyData]);

  const hasDirtyDrafts = useMemo(() => {
    for (const [key, draft] of drafts.entries()) {
      const [habitId, date] = key.split(":");
      if (isDraftDirty(habitId, date, draft)) return true;
    }
    return false;
  }, [drafts, isDraftDirty]);

  const requestClose = useCallback(() => {
    if (hasDirtyDrafts) {
      setShowDiscardConfirm(true);
    } else {
      setIsOpen(false);
      setEditingHabitId(null);
    }
  }, [hasDirtyDrafts]);

  const forceCloseAndDiscard = useCallback(() => {
    setDrafts(new Map());
    setErrors(new Map());
    setShowDiscardConfirm(false);
    setIsOpen(false);
    setEditingHabitId(null);
  }, []);

  const cancelDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
  }, []);

  const getDraft = useCallback((habitId: string, date: string): HabitHistoryDraft => {
    const key = `${habitId}:${date}`;
    const existing = drafts.get(key);
    if (existing) return existing;

    const checkIn = historyData?.checkIns.find(
      (c) => c.habitId === habitId && c.day === date
    );
    return {
      done: checkIn ? checkIn.done : null,
      amount: checkIn?.amount !== null && checkIn?.amount !== undefined ? String(checkIn.amount) : "",
      note: checkIn?.note ?? "",
      touchedAmount: false,
      touchedNote: false
    };
  }, [drafts, historyData]);

  const setDraft = useCallback((
    habitId: string,
    date: string,
    updater: Partial<HabitHistoryDraft> | ((prev: HabitHistoryDraft) => HabitHistoryDraft)
  ) => {
    const key = `${habitId}:${date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = getDraft(habitId, date);
      const updated = typeof updater === "function" ? updater(current) : { ...current, ...updater };
      next.set(key, updated);
      return next;
    });
  }, [getDraft]);

  const clearDraft = useCallback((habitId: string, date: string) => {
    const key = `${habitId}:${date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const saveCheckIn = useCallback(async (
    habitId: string,
    date: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const key = `${habitId}:${date}`;
    const draft = getDraft(habitId, date);

    if (draft.done === null) {
      const errorMsg = "Please mark Done or Not done before saving.";
      setErrors((prev) => new Map(prev).set(key, { message: errorMsg }));
      return { ok: false, error: errorMsg };
    }

    // Server backfill window guard: never retarget
    if (historyData) {
      if (date < historyData.earliestDate || date > historyData.latestDate) {
        const errorMsg = "Check-in date is outside the backfill window. This day has closed.";
        setErrors((prev) => new Map(prev).set(key, { message: errorMsg, field: "date" }));
        return { ok: false, error: errorMsg };
      }
    }

    const currentPending = pendingMutations.current.get(key);
    if (currentPending?.isSaving) {
      return { ok: false, error: "Save already in flight for this habit and date." };
    }

    let parsedAmount: number | null | undefined = undefined;
    if (draft.touchedAmount) {
      const trimmed = draft.amount.trim();
      if (trimmed === "") {
        parsedAmount = null;
      } else {
        const num = Number(trimmed);
        if (!Number.isInteger(num) || num < 0 || num > 1_000_000) {
          const errorMsg = "Check-in amount must be a whole number between 0 and 1,000,000.";
          setErrors((prev) => new Map(prev).set(key, { message: errorMsg, field: "amount" }));
          return { ok: false, error: errorMsg };
        }
        parsedAmount = num;
      }
    }

    let parsedNote: string | null | undefined = undefined;
    if (draft.touchedNote) {
      parsedNote = draft.note === "" ? null : draft.note;
      if (parsedNote && parsedNote.length > 2_000) {
        const errorMsg = "Check-in note must be 2,000 characters or fewer.";
        setErrors((prev) => new Map(prev).set(key, { message: errorMsg, field: "note" }));
        return { ok: false, error: errorMsg };
      }
    }

    const payload: {
      date: string;
      done: boolean;
      amount?: number | null;
      note?: string | null;
    } = {
      date,
      done: draft.done,
      ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
      ...(parsedNote !== undefined ? { note: parsedNote } : {})
    };

    const fingerprint = JSON.stringify(payload);
    let mutationId: string;
    if (currentPending && currentPending.fingerprint === fingerprint) {
      mutationId = currentPending.mutationId;
    } else {
      mutationId = crypto.randomUUID();
    }

    pendingMutations.current.set(key, {
      mutationId,
      fingerprint,
      isUncertain: false,
      isSaving: true
    });

    try {
      const confirmed = await recordCheckIn(habitId, payload, mutationId);

      // Confirmed write success
      pendingMutations.current.delete(key);
      clearDraft(habitId, date);
      setEditingHabitId((cur) => (cur === habitId ? null : cur));

      // Update local history checkIns state immediately
      setHistoryData((prev) => {
        if (!prev) return prev;
        const filtered = prev.checkIns.filter(
          (c) => !(c.habitId === habitId && c.day === date)
        );
        const newRecord: HabitHistoryCheckIn = {
          id: confirmed.id,
          habitId: confirmed.habitId,
          date: confirmed.date,
          day: date,
          done: confirmed.done,
          amount: confirmed.amount,
          note: confirmed.note
        };
        return {
          ...prev,
          checkIns: [...filtered, newRecord]
        };
      });

      setAppAnnouncement?.("Saved check-in.");

      // Refresh shell bootstrap read-model
      if (refreshAfterConfirmedMutation) {
        void refreshAfterConfirmedMutation().catch(() => {});
      }

      // Refresh history in background
      void loadHistory(false).catch(() => {
        setRefreshError("Saved, but history refresh failed. Try Refreshing.");
      });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check-in could not be saved.";
      const field = error instanceof ApiError ? error.field : undefined;

      const isValidationError = error instanceof ApiError && error.status === 400;
      pendingMutations.current.set(key, {
        mutationId,
        fingerprint,
        isUncertain: !isValidationError,
        isSaving: false
      });

      setErrors((prev) => new Map(prev).set(key, { message, field }));
      return { ok: false, error: message };
    }
  }, [
    getDraft,
    historyData,
    clearDraft,
    setAppAnnouncement,
    refreshAfterConfirmedMutation,
    loadHistory
  ]);

  const reconcileRecord = useCallback(async (
    habitId: string,
    date: string
  ): Promise<HabitCheckInReconciliation | null> => {
    const key = `${habitId}:${date}`;
    try {
      const result = await fetchHabitCheckInDate(habitId, date);
      pendingMutations.current.delete(key);
      clearDraft(habitId, date);

      setHistoryData((prev) => {
        if (!prev) return prev;
        const filtered = prev.checkIns.filter(
          (c) => !(c.habitId === habitId && c.day === date)
        );
        return {
          ...prev,
          checkIns: result.checkIn ? [...filtered, result.checkIn] : filtered
        };
      });
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setAppAnnouncement?.("Reconciled record with server.");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reconciliation failed.";
      setErrors((prev) => new Map(prev).set(key, { message }));
      return null;
    }
  }, [clearDraft, setAppAnnouncement]);

  const activeHabits = useMemo(() => {
    if (!historyData) return [];
    return historyData.habits
      .filter((h) => h.status === "ACTIVE")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [historyData]);

  const archivedHabits = useMemo(() => {
    if (!historyData) return [];
    return historyData.habits
      .filter((h) => h.status === "ARCHIVED")
      .sort((a, b) => {
        const aArch = a.archivedAt ?? "";
        const bArch = b.archivedAt ?? "";
        return bArch.localeCompare(aArch) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
      });
  }, [historyData]);

  return {
    isOpen,
    openHistory,
    requestClose,
    forceCloseAndDiscard,
    cancelDiscard,
    showDiscardConfirm,
    hasDirtyDrafts,
    showArchived,
    setShowArchived,
    selectedDate,
    setSelectedDate,
    dates,
    historyData,
    activeHabits,
    archivedHabits,
    loading,
    loadError,
    refreshError,
    refreshHistory: () => loadHistory(false),
    editingHabitId,
    setEditingHabitId,
    getDraft,
    setDraft,
    clearDraft,
    saveCheckIn,
    reconcileRecord,
    errors,
    pendingMutations: pendingMutations.current
  };
}
