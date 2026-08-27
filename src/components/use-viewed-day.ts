"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isViewedDayPayload,
  type ViewedDayKind,
  type ViewedDayPayload
} from "@/lib/day-records";

const LOAD_FAILURE =
  "That day could not be loaded. Check that Dayflow is still running.";

export type ViewedDayState = {
  dayKey: string;
  kind: ViewedDayKind;
  payload: ViewedDayPayload | null;
  loading: boolean;
  error: string;
  earliestDayKey: string | null;
  forwardWeeks: number | null;
};

/**
 * Track which day Log is showing.
 *
 * Today is served by the bootstrap payload the session already has, so viewing
 * today costs no request and behaves exactly as before. Only another day is
 * fetched.
 */
export function useViewedDay(
  todayKey: string,
  initialEarliestDayKey: string | null,
  initialForwardWeeks: number | null
) {
  const [state, setState] = useState<ViewedDayState>({
    dayKey: todayKey,
    kind: "today",
    payload: null,
    loading: false,
    error: "",
    earliestDayKey: initialEarliestDayKey,
    forwardWeeks: initialForwardWeeks
  });
  const request = useRef(0);

  const load = useCallback(
    async (dayKey: string) => {
      const ticket = (request.current += 1);
      if (dayKey === todayKey) {
        setState((current) => ({
          ...current,
          dayKey,
          kind: "today",
          payload: null,
          loading: false,
          error: ""
        }));
        return true;
      }
      setState((current) => ({ ...current, dayKey, loading: true, error: "" }));
      try {
        const response = await fetch(
          `/api/day?date=${encodeURIComponent(dayKey)}`,
          { cache: "no-store" }
        );
        const body = response.ok ? await response.json() : null;
        if (ticket !== request.current) return false;
        if (!response.ok || !isViewedDayPayload(body)) {
          setState((current) => ({
            ...current,
            loading: false,
            error: LOAD_FAILURE
          }));
          return false;
        }
        setState({
          dayKey: body.dateKey,
          kind: body.kind,
          payload: body,
          loading: false,
          error: "",
          earliestDayKey: body.earliestDayKey,
          forwardWeeks: body.forwardWeeks
        });
        return true;
      } catch {
        if (ticket !== request.current) return false;
        setState((current) => ({
          ...current,
          loading: false,
          error: LOAD_FAILURE
        }));
        return false;
      }
    },
    [todayKey]
  );

  const goToToday = useCallback(() => {
    request.current += 1;
    setState((current) => ({
      ...current,
      dayKey: todayKey,
      kind: "today",
      payload: null,
      loading: false,
      error: ""
    }));
  }, [todayKey]);

  useEffect(() => {
    setState((current) => ({
      ...current,
      earliestDayKey: initialEarliestDayKey,
      forwardWeeks: initialForwardWeeks
    }));
  }, [initialEarliestDayKey, initialForwardWeeks]);

  // The local day rolling over makes the viewed day a different kind of day,
  // so the only honest thing to show is the new today.
  useEffect(() => {
    goToToday();
  }, [todayKey, goToToday]);

  return { ...state, setDay: load, goToToday };
}
