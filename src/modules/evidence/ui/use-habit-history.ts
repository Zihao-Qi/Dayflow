"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHabitCheckInDate,
  fetchHabitHistory,
  type HabitHistoryCheckIn,
  type HabitHistoryDefinition,
  type HabitHistoryPayload
} from "./history-api";
import { recordCheckIn } from "./api";
import { addDays, localDateKey, parseLocalDate } from "@/shared/kernel/calendar";
import { ApiError } from "@/shared/client/api-client";
import {
  beginCheckInSave,
  beginHistoryLoad,
  beginReconcile,
  clearHistoryDraft,
  createHistorySession,
  discardUnsentHistoryEdits,
  hasDiscardableDrafts,
  historyDayRefresh,
  historyForegroundRefresh,
  materializeDraft,
  selectHistoryDate,
  setHistoryEditor,
  settleCheckInSave,
  settleHistoryLoad,
  settleReconcile,
  updateHistoryDraft,
  type HabitHistoryDraft,
  type HistorySession,
  type PendingIntention
} from "./habit-history-controller";

export type { HabitHistoryDraft, PendingIntention };

export type HabitHistoryDayState = "done" | "notDone" | "unrecorded" | "outOfScope";

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
  setAppAnnouncement
}: UseHabitHistoryOptions = {}) {
  const sessionRef = useRef<HistorySession>(createHistorySession(initialTodayKey ?? ""));
  const [session, setSession] = useState(sessionRef.current);
  const [isOpen, setIsOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const commit = useCallback((next: HistorySession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const runLoad = useCallback(async () => {
    const started = beginHistoryLoad(sessionRef.current);
    commit(started.session);
    try {
      const data = await fetchHabitHistory();
      const settled = settleHistoryLoad(sessionRef.current, started.generation, started.startedAt, {
        ok: true,
        data
      });
      commit(settled.session);
      return settled.applied && settled.session.loadError === null && settled.session.refreshError === null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Habit history could not be loaded.";
      const settled = settleHistoryLoad(sessionRef.current, started.generation, started.startedAt, {
        ok: false,
        message
      });
      commit(settled.session);
      return false;
    }
  }, [commit]);

  const openHistory = useCallback(() => {
    setIsOpen(true);
    setShowDiscardConfirm(false);
    void runLoad();
  }, [runLoad]);

  const todaySeen = useRef(initialTodayKey);
  useEffect(() => {
    const previous = todaySeen.current;
    todaySeen.current = initialTodayKey;
    if (!sessionRef.current.selectedDate && initialTodayKey) {
      commit(selectHistoryDate(sessionRef.current, initialTodayKey));
    }
    if (historyDayRefresh(previous, initialTodayKey) && isOpen) void runLoad();
  }, [initialTodayKey, isOpen, commit, runLoad]);

  useEffect(() => {
    if (!isOpen) return;
    const onForeground = () => {
      if (historyForegroundRefresh(true, document.visibilityState)) void runLoad();
    };
    document.addEventListener("visibilitychange", onForeground);
    return () => document.removeEventListener("visibilitychange", onForeground);
  }, [isOpen, runLoad]);

  const dates = useMemo(() => {
    if (session.history) {
      return generateDateRange(session.history.earliestDate, session.history.latestDate);
    }
    if (initialTodayKey) {
      const today = parseLocalDate(initialTodayKey);
      if (today) return generateDateRange(localDateKey(addDays(today, -7)), initialTodayKey);
    }
    return [];
  }, [session.history, initialTodayKey]);

  const requestClose = useCallback(() => {
    if (hasDiscardableDrafts(sessionRef.current)) setShowDiscardConfirm(true);
    else {
      setIsOpen(false);
      commit(setHistoryEditor(sessionRef.current, null));
    }
  }, [commit]);

  const forceCloseAndDiscard = useCallback(() => {
    commit(discardUnsentHistoryEdits(sessionRef.current));
    setShowDiscardConfirm(false);
    setIsOpen(false);
  }, [commit]);

  const cancelDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
  }, []);

  const getDraft = useCallback(
    (habitId: string, date: string) => materializeDraft(session, habitId, date),
    [session]
  );

  const setDraft = useCallback((
    habitId: string,
    date: string,
    updater: Partial<HabitHistoryDraft> | ((prev: HabitHistoryDraft) => HabitHistoryDraft)
  ) => {
    commit(updateHistoryDraft(sessionRef.current, habitId, date, updater));
  }, [commit]);

  const clearDraft = useCallback((habitId: string, date: string) => {
    commit(clearHistoryDraft(sessionRef.current, habitId, date));
  }, [commit]);

  const saveCheckIn = useCallback(async (habitId: string, date: string) => {
    const draft = materializeDraft(sessionRef.current, habitId, date);
    const begun = beginCheckInSave(sessionRef.current, {
      habitId,
      date,
      draft,
      createId: () => crypto.randomUUID()
    });
    commit(begun.session);
    if (!begun.ok) return { ok: false as const, error: begun.error };
    try {
      const confirmed = await recordCheckIn(habitId, begun.body, begun.mutationId);
      const checkIn: HabitHistoryCheckIn = {
        id: confirmed.id,
        habitId,
        date: confirmed.date,
        day: date,
        done: confirmed.done,
        amount: confirmed.amount,
        note: confirmed.note
      };
      const settled = settleCheckInSave(sessionRef.current, {
        habitId,
        date,
        mutationId: begun.mutationId,
        startedAt: begun.startedAt,
        outcome: { type: "success", checkIn }
      });
      commit(settled.session);
      if (settled.announcement) setAppAnnouncement?.(settled.announcement);
      if (settled.shellRefresh) void refreshAfterConfirmedMutation?.().catch(() => {});
      if (settled.refreshHistory) void runLoad();
      return settled.result;
    } catch (error) {
      const settled = settleCheckInSave(sessionRef.current, {
        habitId,
        date,
        mutationId: begun.mutationId,
        startedAt: begun.startedAt,
        outcome: {
          type: "failure",
          status: error instanceof ApiError ? error.status : undefined,
          message: error instanceof Error ? error.message : "Check-in could not be saved.",
          field: error instanceof ApiError ? error.field : undefined
        }
      });
      commit(settled.session);
      return settled.result;
    }
  }, [commit, refreshAfterConfirmedMutation, runLoad, setAppAnnouncement]);

  const reconcileRecord = useCallback(async (habitId: string, date: string) => {
    const started = beginReconcile(sessionRef.current);
    commit(started.session);
    try {
      const result = await fetchHabitCheckInDate(habitId, date);
      const settled = settleReconcile(sessionRef.current, {
        habitId,
        date,
        startedAt: started.startedAt,
        outcome: { ok: true, result }
      });
      commit(settled.session);
      if (settled.announcement) setAppAnnouncement?.(settled.announcement);
      if (settled.shellRefresh) void refreshAfterConfirmedMutation?.().catch(() => {});
      if (settled.refreshHistory) void runLoad();
      return result;
    } catch (error) {
      const settled = settleReconcile(sessionRef.current, {
        habitId,
        date,
        startedAt: started.startedAt,
        outcome: {
          ok: false,
          message: error instanceof Error ? error.message : "Reconciliation failed."
        }
      });
      commit(settled.session);
      return null;
    }
  }, [commit, refreshAfterConfirmedMutation, runLoad, setAppAnnouncement]);

  const activeHabits = useMemo(() => {
    if (!session.history) return [];
    return session.history.habits
      .filter((habit) => habit.status === "ACTIVE")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [session.history]);

  const archivedHabits = useMemo(() => {
    if (!session.history) return [];
    return session.history.habits
      .filter((habit) => habit.status === "ARCHIVED")
      .sort((a, b) => {
        const aArch = a.archivedAt ?? "";
        const bArch = b.archivedAt ?? "";
        return bArch.localeCompare(aArch) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
      });
  }, [session.history]);

  return {
    isOpen,
    openHistory,
    requestClose,
    forceCloseAndDiscard,
    cancelDiscard,
    showDiscardConfirm,
    hasDirtyDrafts: hasDiscardableDrafts(session),
    showArchived,
    setShowArchived,
    selectedDate: session.selectedDate,
    setSelectedDate: (date: string) => commit(selectHistoryDate(sessionRef.current, date)),
    dates,
    historyData: session.history,
    activeHabits,
    archivedHabits,
    loading: session.loading,
    loadError: session.loadError,
    refreshError: session.refreshError,
    refreshHistory: () => runLoad(),
    editingHabitId: session.editingHabitId,
    setEditingHabitId: (habitId: string | null) => commit(setHistoryEditor(sessionRef.current, habitId)),
    getDraft,
    setDraft,
    clearDraft,
    saveCheckIn,
    reconcileRecord,
    errors: session.errors,
    pendingMutations: session.pending
  };
}
