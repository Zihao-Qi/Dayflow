"use client";

import {
  loadReviewDetail as loadReviewDetailRequest,
  loadReviewHistory as loadReviewHistoryRequest,
  loadReviewWindow as loadReviewWindowRequest
} from "@/components/dashboard-api";
import {
  type PastReviewDetail,
  type PastReviewRecord,
  type ReviewWindowDetail
} from "@/lib/review-records";
import { useCallback, useEffect, useRef, useState } from "react";
import { createReadGeneration } from "@/shared/client/read-generation";

const REVIEW_HISTORY_LIMIT = 20;
const LIST_FAILURE =
  "Earlier reviews could not be loaded. Check that Dayflow is still running.";
const DETAIL_FAILURE =
  "That review could not be opened. Check that Dayflow is still running.";
const WINDOW_FAILURE =
  "That Review Window could not be opened. Check the date and try again.";

export type ReviewHistoryState = {
  open: boolean;
  items: PastReviewRecord[];
  nextCursor: string | null;
  totalCount: number | null;
  loaded: boolean;
  loading: boolean;
  error: string;
  selected: PastReviewDetail | null;
  selecting: boolean;
  selectionError: string;
  window: ReviewWindowDetail | null;
  windowLoading: boolean;
  windowError: string;
  windowEnding: string;
};

const initialState: ReviewHistoryState = {
  open: false,
  items: [],
  nextCursor: null,
  totalCount: null,
  loaded: false,
  loading: false,
  error: "",
  selected: null,
  selecting: false,
  selectionError: "",
  window: null,
  windowLoading: false,
  windowError: "",
  windowEnding: ""
};

export function useReviewHistory(calendarKey: string) {
  const [state, setState] = useState<ReviewHistoryState>(initialState);
  const listOwner = useRef(createReadGeneration()).current;
  const detailOwner = useRef(createReadGeneration()).current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const selection = useRef<{ id: string } | { ending: string } | null>(null);
  const windowEndingRequest = useRef("");

  const loadPage = useCallback(async (cursor: string | null, count = REVIEW_HISTORY_LIMIT) => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      return await listOwner.run(async () => {
        const query = new URLSearchParams({ limit: String(REVIEW_HISTORY_LIMIT) });
        if (cursor) query.set("cursor", cursor);
        const payload = await loadReviewHistoryRequest(query);
        // Refresh all pages already opened without discarding the selection.
        while (!cursor && payload.nextCursor && payload.items.length < count) {
          query.set("cursor", payload.nextCursor);
          const next = await loadReviewHistoryRequest(query);
          payload.items.push(...next.items);
          payload.nextCursor = next.nextCursor;
        }
        return payload;
      }, (payload) => setState((current) => ({
        ...current, loaded: true, error: "",
        items: cursor ? [...current.items, ...payload.items] : payload.items,
        nextCursor: payload.nextCursor, totalCount: payload.totalCount
      })), () => setState((current) => ({ ...current, error: LIST_FAILURE })),
      () => setState((current) => ({ ...current, loading: false })));
    } catch { return false; }
  }, [listOwner]);

  const openHistory = useCallback(() => {
    setState((current) => ({ ...current, open: true }));
    void loadPage(null);
  }, [loadPage]);

  const closeHistory = useCallback(() => {
    listOwner.invalidate();
    detailOwner.invalidate();
    selection.current = null;
    setState(initialState);
  }, [listOwner, detailOwner]);

  const loadNext = useCallback(() => {
    setState((current) => {
      if (current.loading || !current.nextCursor) return current;
      void loadPage(current.nextCursor);
      return current;
    });
  }, [loadPage]);

  const retry = useCallback(() => {
    void loadPage(null);
  }, [loadPage]);

  const select = useCallback(async (id: string) => {
    selection.current = { id };
    setState((current) => ({ ...current, selecting: true, selectionError: "", windowLoading: false }));
    try {
      return await detailOwner.run(() => loadReviewDetailRequest(id),
        (payload) => setState((current) => ({
          ...current, selectionError: "", selected: payload, window: null,
          windowLoading: false, windowError: ""
        })), () => setState((current) => ({ ...current, selectionError: DETAIL_FAILURE })),
        () => setState((current) => ({ ...current, selecting: false })));
    } catch { return false; }
  }, [detailOwner]);

  const selectWindow = useCallback(async (ending: string) => {
    selection.current = { ending };
    windowEndingRequest.current = ending;
    setState((current) => ({ ...current, selecting: false, windowLoading: true, windowError: "", windowEnding: ending }));
    try {
      return await detailOwner.run(() => loadReviewWindowRequest(new URLSearchParams({ ending })),
        (payload) => setState((current) => ({
          ...current, selected: null, selectionError: "", window: payload, windowError: ""
        })), () => setState((current) => ({ ...current, windowError: WINDOW_FAILURE })),
        () => setState((current) => ({ ...current, windowLoading: false })));
    } catch { return false; }
  }, [detailOwner]);

  const retryWindow = useCallback(() => {
    if (windowEndingRequest.current) {
      void selectWindow(windowEndingRequest.current);
    }
  }, [selectWindow]);

  const clearSelection = useCallback(() => {
    detailOwner.invalidate();
    selection.current = null;
    setState((current) => ({
      ...current,
      selected: null,
      selecting: false,
      selectionError: "",
      window: null,
      windowLoading: false,
      windowError: ""
    }));
  }, [detailOwner]);

  const refresh = useCallback(async () => {
    if (!stateRef.current.open) return true;
    const selected = selection.current;
    const outcomes = await Promise.all([
      loadPage(null, stateRef.current.items.length),
      selected ? ("id" in selected ? select(selected.id) : selectWindow(selected.ending)) : Promise.resolve(true)
    ]);
    return outcomes.every(Boolean);
  }, [loadPage, select, selectWindow]);

  useEffect(() => {
    listOwner.invalidate();
    detailOwner.invalidate();
    void refresh();
    return () => { listOwner.invalidate(); detailOwner.invalidate(); };
  }, [calendarKey, listOwner, detailOwner, refresh]);

  return {
    refresh,
    ...state,
    openHistory,
    closeHistory,
    loadNext,
    retry,
    select,
    selectWindow,
    retryWindow,
    clearSelection
  };
}
