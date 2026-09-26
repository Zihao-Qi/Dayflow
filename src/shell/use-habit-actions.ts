"use client";

import { useRef, useState } from "react";
import {
  createHabit,
  recordCheckIn,
  renameHabit,
  archiveHabit,
  reorderHabits as reorderHabitsRequest
} from "@/modules/evidence/ui/api";
import { type HabitSummaryRecord } from "@/shared/client/decoders";
import { mutationIdFor, type PendingMutation } from "@/shared/client/mutation-ids";
import {
  describeHabitMove,
  summarizeHabits,
  type HabitDefinition,
  type HabitCadenceValue
} from "@/modules/evidence/domain/habit";
import { parseLocalDate, reviewPeriodRange, startOfLocalDay, localDateKey } from "@/shared/kernel/calendar";
import { ApiError } from "@/shared/client/api-client";
import { type ShellState } from "./use-shell-state";

export function useHabitActions({
  data,
  setData,
  setAppError,
  setAppAnnouncement,
  refreshAfterConfirmedMutation
}: Pick<
  ShellState,
  | "data"
  | "setData"
  | "setAppError"
  | "setAppAnnouncement"
> & {
  refreshAfterConfirmedMutation: () => Promise<boolean>;
}) {
  const [busyHabitIds, setBusyHabitIds] = useState<ReadonlySet<string>>(() => new Set());
  const [habitCreatePending, setHabitCreatePending] = useState(false);
  const [reorderPending, setReorderPending] = useState(false);
  const habitCreateMutation = useRef<PendingMutation | null>(null);
  const reorderMutation = useRef<PendingMutation | null>(null);
  const renameMutations = useRef<Map<string, PendingMutation>>(new Map());
  const archiveMutations = useRef<Map<string, PendingMutation>>(new Map());
  const checkInMutations = useRef<Map<string, PendingMutation>>(new Map());

  async function createHabitFromDraft(
    name: string,
    cadence: HabitCadenceValue = "DAILY",
    targetPerWeek: number = 7
  ) {
    const trimmed = name.trim();
    if (!trimmed || habitCreatePending) return false;
    const effectiveTarget = cadence === "DAILY" ? 7 : Math.min(Math.max(targetPerWeek, 1), 7);
    const payload = { name: trimmed, cadence, targetPerWeek: effectiveTarget };
    const mutationId = mutationIdFor(habitCreateMutation, payload);
    setHabitCreatePending(true);

    try {
      const result = await createHabit(payload, mutationId);

      // Confirmed write success: retire mutation id and accept habit into local state
      habitCreateMutation.current = null;
      setData((current) => {
        if (!current) return current;
        if (current.habits.some((h) => h.id === result.id)) return current;
        const todayDate = parseLocalDate(current.todayKey) ?? startOfLocalDay(new Date(current.today));
        const periodStart = reviewPeriodRange(todayDate).start;
        const definition: HabitDefinition = {
          id: result.id,
          name: result.name,
          cadence: result.cadence,
          targetPerWeek: result.targetPerWeek,
          sortOrder: result.sortOrder ?? current.habits.length,
          createdAt: todayDate,
          archivedAt: null
        };
        const [newSummary] = summarizeHabits([definition], [], periodStart, todayDate, 7);
        return {
          ...current,
          habits: [...current.habits, newSummary as HabitSummaryRecord]
        };
      });

      setAppError("");
      setAppAnnouncement("Saved.");
      await refreshAfterConfirmedMutation();
      return true;
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Habit could not be saved. Your draft is still here."
      );
      setAppAnnouncement("Habit status unconfirmed. Your draft is still here.");
      return false;
    } finally {
      setHabitCreatePending(false);
    }
  }

  async function recordHabitCheckIn(
    habitId: string,
    done: boolean,
    details?: { amount?: number | null; note?: string | null }
  ): Promise<{ ok: boolean; error?: string; field?: string }> {
    if (!data) return { ok: false, error: "Workspace data is not loaded." };
    const targetDateKey = data.todayKey;

    const payload: {
      date: string;
      done: boolean;
      amount?: number | null;
      note?: string | null;
    } = {
      date: targetDateKey,
      done,
      ...(details && details.amount !== undefined ? { amount: details.amount } : {}),
      ...(details && details.note !== undefined ? { note: details.note } : {})
    };

    const fingerprint = JSON.stringify(payload);
    const mutationKey = `${habitId}:${targetDateKey}:${fingerprint}`;
    const existing = checkInMutations.current.get(mutationKey);
    const mutationId = existing ? existing.id : crypto.randomUUID();
    if (!existing) {
      checkInMutations.current.set(mutationKey, { id: mutationId, fingerprint });
    }

    setBusyHabitIds((prev) => {
      const next = new Set(prev);
      next.add(habitId);
      return next;
    });

    try {
      const result = await recordCheckIn(habitId, payload, mutationId);
      const confirmedDayKey = result.date ? localDateKey(new Date(result.date)) : targetDateKey;

      // Confirmed write success: retire all pending mutation entries for this habit and day
      for (const key of Array.from(checkInMutations.current.keys())) {
        if (
          key.startsWith(`${habitId}:${targetDateKey}:`) ||
          key.startsWith(`${habitId}:${confirmedDayKey}:`)
        ) {
          checkInMutations.current.delete(key);
        }
      }

      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          habits: current.habits.map((h) => {
            if (h.id !== habitId) return h;
            const updatedDays = h.days.map((d) =>
              d.day === confirmedDayKey
                ? {
                    ...d,
                    state: done ? ("done" as const) : ("notDone" as const),
                    amount: result.amount !== undefined ? result.amount : d.amount
                  }
                : d
            );
            const recomputedDoneCount = updatedDays.filter((d) => d.state === "done").length;
            const isToday = confirmedDayKey === current.todayKey;
            const previousToday = h.today;
            const updatedToday = isToday
              ? {
                  done,
                  amount: result.amount !== undefined ? result.amount : (previousToday?.amount ?? null),
                  note: result.note !== undefined ? result.note : (previousToday?.note ?? null)
                }
              : h.today;
            return {
              ...h,
              today: updatedToday,
              days: updatedDays,
              doneCount: recomputedDoneCount
            };
          })
        };
      });
      setAppError("");
      await refreshAfterConfirmedMutation();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Check-in could not be saved.";
      const field = error instanceof ApiError ? error.field : undefined;
      if (!details) {
        setAppError(message);
      }
      return { ok: false, error: message, field };
    } finally {
      setBusyHabitIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  }

  async function renameHabitAction(
    habitId: string,
    name: string
  ): Promise<{ ok: boolean; error?: string }> {
    const existing = renameMutations.current.get(habitId);
    const fingerprint = JSON.stringify({ habitId, name });
    let mutationId: string;
    if (existing && existing.fingerprint === fingerprint) {
      mutationId = existing.id;
    } else {
      mutationId = crypto.randomUUID();
      renameMutations.current.set(habitId, { id: mutationId, fingerprint });
    }

    try {
      const result = await renameHabit(habitId, name, mutationId);

      // Confirmed write success: retire mutation id and update local state
      renameMutations.current.delete(habitId);
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          habits: current.habits.map((h) =>
            h.id === habitId ? { ...h, name: result.name } : h
          )
        };
      });

      setAppError("");
      setAppAnnouncement("Saved.");
      await refreshAfterConfirmedMutation();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Habit could not be renamed.";
      return { ok: false, error: message };
    }
  }

  async function archiveHabitAction(habitId: string): Promise<boolean> {
    const existing = archiveMutations.current.get(habitId);
    const mutationId = existing ? existing.id : crypto.randomUUID();
    if (!existing) {
      archiveMutations.current.set(habitId, { id: mutationId, fingerprint: habitId });
    }

    setBusyHabitIds((prev) => {
      const next = new Set(prev);
      next.add(habitId);
      return next;
    });

    try {
      await archiveHabit(habitId, mutationId);

      // Confirmed write success: retire mutation id
      archiveMutations.current.delete(habitId);

      // On confirmed success the row leaves the card without waiting for the refresh
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          habits: current.habits.filter((h) => h.id !== habitId)
        };
      });

      setAppError("");
      setAppAnnouncement("Habit archived.");
      await refreshAfterConfirmedMutation();
      return true;
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Habit could not be archived."
      );
      return false;
    } finally {
      setBusyHabitIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  }

  async function reorderHabitsAction(
    habitId: string,
    direction: "up" | "down"
  ): Promise<boolean> {
    if (!data || reorderPending) return false;
    const currentHabits = data.habits;
    const currentIndex = currentHabits.findIndex((h) => h.id === habitId);
    if (currentIndex < 0) return false;
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentHabits.length) return false;

    const reorderedHabits = [...currentHabits];
    const [moved] = reorderedHabits.splice(currentIndex, 1);
    reorderedHabits.splice(targetIndex, 0, moved);

    const targetIds = reorderedHabits.map((h) => h.id);
    const expectedIds = currentHabits.map((h) => h.id);
    const capturedHabits = currentHabits;
    const capturedTodayKey = data.todayKey;

    const payload = { ids: targetIds, expectedIds };
    const mutationId = mutationIdFor(reorderMutation, payload);
    setReorderPending(true);

    try {
      await reorderHabitsRequest(targetIds, expectedIds, mutationId);
      reorderMutation.current = null;

      setData((current) => {
        if (!current) return current;
        if (current.todayKey !== capturedTodayKey) return current;
        if (current.habits !== capturedHabits) return current;

        const habitMap = new Map(current.habits.map((h) => [h.id, h]));
        const updatedHabits = targetIds.map((id, index) => {
          const item = habitMap.get(id);
          return item ? { ...item, sortOrder: index } : null;
        });
        if (updatedHabits.some((h) => h === null)) return current;

        return {
          ...current,
          habits: updatedHabits as HabitSummaryRecord[]
        };
      });

      setAppError("");
      setAppAnnouncement(
        describeHabitMove(moved.name, targetIndex, currentHabits.length)
      );
      await refreshAfterConfirmedMutation();
      return true;
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 409
          ? (error.message || "Habit order is out of date. Refresh and try again.")
          : "Habit order status unconfirmed. Refresh to check.";
      setAppError(message);
      setAppAnnouncement(
        error instanceof ApiError && error.status === 409
          ? "Habit order is out of date."
          : "Habit order status unconfirmed."
      );
      return false;
    } finally {
      setReorderPending(false);
    }
  }

  return {
    busyHabitIds,
    habitCreatePending,
    reorderPending,
    createHabitFromDraft,
    renameHabit: renameHabitAction,
    archiveHabit: archiveHabitAction,
    recordHabitCheckIn,
    reorderHabits: reorderHabitsAction
  };
}
