"use client";

import { loadViewedDay } from "@/components/dashboard-api";
import type { ActivityEntry } from "@/components/activity-records";
import { localDateKey } from "@/lib/dates";
import type { TimeBlockRecord } from "@/lib/time-blocks";
import type { ViewedDayKind, ViewedDayPayload } from "@/shared/client/decoders";
import { createReadGeneration } from "@/shared/client/read-generation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "./backlog-model";

export type ViewedDayState = {
  dayKey: string;
  kind: ViewedDayKind;
  payload: ViewedDayPayload | null;
  loading: boolean;
  error: string;
  earliestDayKey: string | null;
  forwardWeeks: number | null;
};

/** Today and Log share one active day read; every destination entry reloads it. */
export function useViewedDay(
  todayKey: string,
  initialEarliestDayKey: string | null,
  initialForwardWeeks: number | null,
  destination: "today" | "log" | null
) {
  const owner = useRef(createReadGeneration()).current;
  const selectedKey = useRef(todayKey);
  const [entry, setEntry] = useState({ destination, todayKey });
  const [state, setState] = useState<ViewedDayState>({
    dayKey: todayKey, kind: "today", payload: null, loading: false, error: "",
    earliestDayKey: initialEarliestDayKey, forwardWeeks: initialForwardWeeks
  });
  const load = useCallback(async (dayKey: string) => {
    if (!dayKey) return true;
    selectedKey.current = dayKey;
    setState((current) => ({
      ...current, dayKey, kind: dayKey === todayKey ? "today" : dayKey < todayKey ? "past" : "future",
      payload: current.dayKey === dayKey ? current.payload : null,
      loading: true, error: ""
    }));
    try {
      return await owner.run(() => loadViewedDay(dayKey), (body) => {
        setState({
          dayKey: body.dateKey, kind: body.kind, payload: body, loading: false,
          error: "", earliestDayKey: body.earliestDayKey, forwardWeeks: body.forwardWeeks
        });
      }, () => setState((current) => ({
        ...current, error: "That day could not be loaded. Check that Dayflow is still running."
      })), () => setState((current) => ({ ...current, loading: false })));
    } catch { return false; }
  }, [owner, todayKey]);

  useEffect(() => {
    owner.invalidate();
    setEntry({ destination, todayKey });
    selectedKey.current = todayKey;
    setState((current) => ({ ...current, dayKey: todayKey, kind: "today", payload: null, loading: Boolean(destination && todayKey), error: "" }));
    if (destination && todayKey) void load(todayKey);
    return () => owner.invalidate();
  }, [destination, todayKey, load, owner]);

  useEffect(() => {
    setState((current) => ({ ...current, earliestDayKey: initialEarliestDayKey, forwardWeeks: initialForwardWeeks }));
  }, [initialEarliestDayKey, initialForwardWeeks]);

  const goToToday = useCallback(() => { void load(todayKey); }, [load, todayKey]);
  const refresh = (newTodayKey?: string) => destination
    ? load(newTodayKey && newTodayKey !== todayKey ? newTodayKey : selectedKey.current || todayKey)
    : Promise.resolve(true);

  function updatePayload(update: (payload: ViewedDayPayload) => ViewedDayPayload) {
    // Local edits supersede older reads; a later read replaces the payload.
    owner.invalidate();
    setState((current) => current.payload ? { ...current, payload: update(current.payload) } : current);
  }
  function patchTask(id: string, patch: Partial<Task>) {
    // An unconfirmed edit outranks older reads but never fails a running refresh.
    owner.outrank();
    setState((current) => current.payload
      ? {
        ...current,
        payload: {
          ...current.payload,
          tasks: current.payload.tasks.map((task) => task.id === id ? { ...task, ...patch } : task)
        }
      }
      : current);
  }
  function acceptTask(task: Task) {
    updatePayload((payload) => ({
      ...payload,
      tasks: [...payload.tasks.filter((item) => item.id !== task.id),
        ...(task.date && localDateKey(new Date(task.date)) === payload.dateKey ? [task] : [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
    }));
  }
  function removeTask(id: string) {
    updatePayload((payload) => ({ ...payload, tasks: payload.tasks.filter((item) => item.id !== id) }));
  }
  function acceptActivity(activity: ActivityEntry) {
    updatePayload((payload) => ({
      ...payload,
      activities: [...payload.activities.filter((item) => item.id !== activity.id),
        ...(localDateKey(new Date(activity.startedAt)) === payload.dateKey ? [activity] : [])]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    }));
  }
  function acceptTimeBlock(block: TimeBlockRecord) {
    updatePayload((payload) => ({ ...payload, timeBlocks: [
      ...payload.timeBlocks.filter((item) => item.id !== block.id),
      ...(block.date === payload.dateKey ? [block] : [])
    ] }));
  }
  function removeTimeBlock(id: string) {
    updatePayload((payload) => ({ ...payload, timeBlocks: payload.timeBlocks.filter((item) => item.id !== id) }));
  }
  const entering = entry.destination !== destination || entry.todayKey !== todayKey;
  return { ...state,
    dayKey: entering ? todayKey : state.dayKey,
    kind: entering ? "today" as const : state.kind,
    payload: entering ? null : state.payload,
    loading: entering ? Boolean(destination) : state.loading,
    error: entering ? "" : state.error,
    setDay: load, goToToday, refresh, patchTask, acceptTask, removeTask, acceptActivity, acceptTimeBlock, removeTimeBlock };
}
