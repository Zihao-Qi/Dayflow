"use client";

import { useRef, useState } from "react";
import { createHabit, recordCheckIn } from "@/modules/evidence/ui/api";
import { type HabitSummaryRecord } from "@/shared/client/decoders";
import { mutationIdFor, type PendingMutation } from "@/shared/client/mutation-ids";
import { targetForCadence } from "@/modules/evidence/domain/habit";
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
  const habitCreateMutation = useRef<PendingMutation | null>(null);

  async function createHabitFromDraft(name: string) {
    const trimmed = name.trim();
    if (!trimmed || habitCreatePending) return false;
    const payload = { name: trimmed };
    const mutationId = mutationIdFor(habitCreateMutation, payload);
    setHabitCreatePending(true);

    try {
      const result = await createHabit(trimmed, mutationId);

      // Confirmed write success: retire mutation id and accept habit into local state
      habitCreateMutation.current = null;
      setData((current) => {
        if (!current) return current;
        if (current.habits.some((h) => h.id === result.id)) return current;
        const newSummary: HabitSummaryRecord = {
          id: result.id,
          name: result.name,
          cadence: result.cadence,
          targetPerWeek: result.targetPerWeek,
          sortOrder: current.habits.length,
          today: null,
          days: [],
          doneCount: 0,
          target: targetForCadence(result.cadence, result.targetPerWeek)
        };
        return {
          ...current,
          habits: [...current.habits, newSummary]
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
      setAppAnnouncement("Habit was not saved.");
      return false;
    } finally {
      setHabitCreatePending(false);
    }
  }

  async function recordHabitCheckIn(habitId: string, done: boolean) {
    if (!data) return;
    setBusyHabitIds((prev) => {
      const next = new Set(prev);
      next.add(habitId);
      return next;
    });

    try {
      await recordCheckIn(habitId, { date: data.todayKey, done }, null);
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          habits: current.habits.map((h) => {
            if (h.id !== habitId) return h;
            const previousToday = h.today;
            const updatedToday = {
              done,
              amount: previousToday?.amount ?? null,
              note: previousToday?.note ?? null
            };
            return {
              ...h,
              today: updatedToday,
              doneCount: done
                ? (previousToday?.done ? h.doneCount : h.doneCount + 1)
                : (previousToday?.done ? Math.max(0, h.doneCount - 1) : h.doneCount)
            };
          })
        };
      });
      setAppError("");
      await refreshAfterConfirmedMutation();
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Check-in could not be saved."
      );
    } finally {
      setBusyHabitIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  }

  return {
    busyHabitIds,
    habitCreatePending,
    createHabitFromDraft,
    recordHabitCheckIn
  };
}
