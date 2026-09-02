"use client";

import { useCallback, useRef, useState } from "react";
import {
  isPastReviewDetail,
  isReviewWindowDetail,
  isReviewHistoryPage,
  type PastReviewDetail,
  type PastReviewRecord,
  type ReviewWindowDetail
} from "@/lib/review-records";

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

export function useReviewHistory() {
  const [state, setState] = useState<ReviewHistoryState>(initialState);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const windowEndingRequest = useRef("");

  const loadPage = useCallback(async (cursor: string | null) => {
    const request = (listRequest.current += 1);
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const query = new URLSearchParams({ limit: String(REVIEW_HISTORY_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/review/history?${query}`);
      const payload = response.ok ? await response.json() : null;
      if (request !== listRequest.current) return;
      if (!response.ok || !isReviewHistoryPage(payload)) {
        setState((current) => ({ ...current, loading: false, error: LIST_FAILURE }));
        return;
      }
      setState((current) => ({
        ...current,
        loading: false,
        loaded: true,
        error: "",
        items: cursor ? [...current.items, ...payload.items] : payload.items,
        nextCursor: payload.nextCursor,
        totalCount: payload.totalCount
      }));
    } catch {
      if (request !== listRequest.current) return;
      setState((current) => ({ ...current, loading: false, error: LIST_FAILURE }));
    }
  }, []);

  const openHistory = useCallback(() => {
    setState((current) => ({ ...current, open: true }));
    void loadPage(null);
  }, [loadPage]);

  const closeHistory = useCallback(() => {
    listRequest.current += 1;
    detailRequest.current += 1;
    setState(initialState);
  }, []);

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
    const request = (detailRequest.current += 1);
    setState((current) => ({
      ...current,
      selecting: true,
      selectionError: "",
      windowLoading: false
    }));
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(id)}`);
      const payload = response.ok ? await response.json() : null;
      if (request !== detailRequest.current) return;
      if (!response.ok || !isPastReviewDetail(payload)) {
        setState((current) => ({
          ...current,
          selecting: false,
          selectionError: DETAIL_FAILURE
        }));
        return;
      }
      setState((current) => ({
        ...current,
        selecting: false,
        selectionError: "",
        selected: payload,
        window: null,
        windowLoading: false,
        windowError: ""
      }));
    } catch {
      if (request !== detailRequest.current) return;
      setState((current) => ({
        ...current,
        selecting: false,
        selectionError: DETAIL_FAILURE
      }));
    }
  }, []);

  const selectWindow = useCallback(async (ending: string) => {
    const request = (detailRequest.current += 1);
    windowEndingRequest.current = ending;
    setState((current) => ({
      ...current,
      selecting: false,
      windowLoading: true,
      windowError: "",
      windowEnding: ending
    }));
    try {
      const query = new URLSearchParams({ ending });
      const response = await fetch(`/api/review/window?${query}`);
      const payload = response.ok ? await response.json() : null;
      if (request !== detailRequest.current) return;
      if (!response.ok || !isReviewWindowDetail(payload)) {
        setState((current) => ({
          ...current,
          windowLoading: false,
          windowError: WINDOW_FAILURE
        }));
        return;
      }
      setState((current) => ({
        ...current,
        selected: null,
        selectionError: "",
        window: payload,
        windowLoading: false,
        windowError: ""
      }));
    } catch {
      if (request !== detailRequest.current) return;
      setState((current) => ({
        ...current,
        windowLoading: false,
        windowError: WINDOW_FAILURE
      }));
    }
  }, []);

  const retryWindow = useCallback(() => {
    if (windowEndingRequest.current) {
      void selectWindow(windowEndingRequest.current);
    }
  }, [selectWindow]);

  const clearSelection = useCallback(() => {
    detailRequest.current += 1;
    setState((current) => ({
      ...current,
      selected: null,
      selecting: false,
      selectionError: "",
      window: null,
      windowLoading: false,
      windowError: ""
    }));
  }, []);

  return {
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
