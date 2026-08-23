"use client";

import { useCallback, useRef, useState } from "react";
import {
  isPastReviewDetail,
  isReviewHistoryPage,
  type PastReviewDetail,
  type PastReviewRecord
} from "@/lib/review-records";

const REVIEW_HISTORY_LIMIT = 20;
const LIST_FAILURE =
  "Earlier reviews could not be loaded. Check that Dayflow is still running.";
const DETAIL_FAILURE =
  "That review could not be opened. Check that Dayflow is still running.";

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
  selectionError: ""
};

export function useReviewHistory() {
  const [state, setState] = useState<ReviewHistoryState>(initialState);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

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
      selectionError: ""
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
        selected: payload
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

  const clearSelection = useCallback(() => {
    detailRequest.current += 1;
    setState((current) => ({
      ...current,
      selected: null,
      selecting: false,
      selectionError: ""
    }));
  }, []);

  return {
    ...state,
    openHistory,
    closeHistory,
    loadNext,
    retry,
    select,
    clearSelection
  };
}
