"use client";

import { useRef, useState } from "react";
import { createHabit, recordCheckIn } from "@/modules/evidence/ui/api";
import { type HabitSummaryRecord } from "@/shared/client/decoders";
import { mutationIdFor, type PendingMutation } from "@/shared/client/mutation-ids";
import { summarizeHabits, type HabitDefinition } from "@/modules/evidence/domain/habit";
import { parseLocalDate, reviewPeriodRange, startOfLocalDay, localDateKey } from "@/shared/kernel/calendar";
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
  const checkInMutations = useRef<Map<string, PendingMutation>>(new Map());

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
        const todayDate = parseLocalDate(current.todayKey) ?? startOfLocalDay(new Date(current.today));
        const periodStart = current.habits[0]?.days.length
          ? (parseLocalDate(current.habits[0].days[0].day) ?? reviewPeriodRange(todayDate).start)
          : (current.review?.periodStart ? (parseLocalDate(current.review.periodStart) ?? reviewPeriodRange(todayDate).start) : reviewPeriodRange(todayDate).start);
        const definition: HabitDefinition = {
          id: result.id,
          name: result.name,
          cadence: result.cadence,
          targetPerWeek: result.targetPerWeek,
          sortOrder: current.habits.length,
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

  async function recordHabitCheckIn(habitId: string, done: boolean) {
    if (!data) return;
    const targetDateKey = data.todayKey;
    const mutationKey = `${habitId}:${targetDateKey}:${done}`;
    const existing = checkInMutations.current.get(mutationKey);
    const mutationId = existing ? existing.id : crypto.randomUUID();
    if (!existing) {
      checkInMutations.current.set(mutationKey, { id: mutationId, fingerprint: mutationKey });
    }

    setBusyHabitIds((prev) => {
      const next = new Set(prev);
      next.add(habitId);
      return next;
    });

    try {
      const result = await recordCheckIn(habitId, { date: targetDateKey, done }, mutationId);
      // Confirmed write success: retire mutation id
      checkInMutations.current.delete(mutationKey);

      const confirmedDayKey = result.date ? localDateKey(new Date(result.date)) : targetDateKey;

      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          habits: current.habits.map((h) => {
            if (h.id !== habitId) return h;
            const updatedDays = h.days.map((d) =>
              d.day === confirmedDayKey
                ? { ...d, state: done ? ("done" as const) : ("notDone" as const), amount: result.amount }
                : d
            );
            const recomputedDoneCount = updatedDays.filter((d) => d.state === "done").length;
            const isToday = confirmedDayKey === current.todayKey;
            const previousToday = h.today;
            const updatedToday = isToday
              ? {
                  done,
                  amount: result.amount ?? previousToday?.amount ?? null,
                  note: result.note ?? previousToday?.note ?? null
                }
              : h.today;
            return {
              ...h,
              today: updatedToday,
              days: updatedDays,
              doneCount: updatedDays.length > 0 ? recomputedDoneCount : (done ? (previousToday?.done ? h.doneCount : h.doneCount + 1) : (previousToday?.done ? Math.max(0, h.doneCount - 1) : h.doneCount))
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
