"use client";

import { journalHistoryMessages, loadJournalHistory as loadJournalHistoryRequest } from "@/modules/journal/ui/api";
import {
  type JournalMaterialRecord,
  type JournalNoteRecord
} from "@/lib/journal-records";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const JOURNAL_HISTORY_LIMIT = 50;
const JOURNAL_SEARCH_DEBOUNCE_MS = 200;

export type JournalHistoryState<T> = {
  items: T[];
  nextCursor: string | null;
  totalCount: number | null;
  loaded: boolean;
  loading: boolean;
  error: string;
};

export type NoteHistoryCriteria = {
  q: string;
  tag: string;
};

export type ReferenceHistoryCriteria = {
  q: string;
};

export type JournalHistoryResult<T, C> = JournalHistoryState<T> & {
  criteria: C;
  setCriteria: (criteria: C) => void;
  loadNext: () => void;
  retry: () => void;
  refresh: () => void;
};

type HistoryKind = "note" | "material";
type HistoryRecord = JournalNoteRecord | JournalMaterialRecord;
type HistoryCriteria = NoteHistoryCriteria | ReferenceHistoryCriteria;
type HistoryRequestMode = "reset" | "append" | "reconcile";
type HistoryRequestDescriptor = {
  mode: HistoryRequestMode;
  cursor: string | null;
  requestQueryKey: string;
  q: string;
  tag: string;
};

const emptyHistory = <T,>(queryKey = ""): JournalHistoryState<T> & {
  queryKey: string;
} => ({
  items: [],
  nextCursor: null,
  totalCount: null,
  loaded: false,
  loading: false,
  error: "",
  queryKey
});

export function useJournalEvidenceHistory(
  kind: "note",
  active: boolean
): JournalHistoryResult<JournalNoteRecord, NoteHistoryCriteria>;
export function useJournalEvidenceHistory(
  kind: "material",
  active: boolean
): JournalHistoryResult<JournalMaterialRecord, ReferenceHistoryCriteria>;
export function useJournalEvidenceHistory(
  kind: HistoryKind,
  active: boolean
): JournalHistoryResult<HistoryRecord, any> {
  const errorMessage = journalHistoryMessages[kind];
  const [criteria, setCriteria] = useState<HistoryCriteria>(
    kind === "note" ? { q: "", tag: "" } : { q: "" }
  );
  const canonicalCriteria = useMemo(
    () => ({
      q: criteria.q.normalize("NFKC").trim(),
      tag:
        kind === "note" && "tag" in criteria
          ? criteria.tag.normalize("NFKC").trim()
          : ""
    }),
    [criteria, kind]
  );
  const queryKey = JSON.stringify({
    kind,
    q: canonicalCriteria.q,
    tag: canonicalCriteria.tag
  });
  const [state, setState] = useState(() =>
    emptyHistory<HistoryRecord>(queryKey)
  );
  const [refreshRevision, setRefreshRevision] = useState(0);
  const stateRef = useRef(state);
  const queryKeyRef = useRef(queryKey);
  const generationRef = useRef(0);
  const requestSerialRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const failedRequestRef = useRef<HistoryRequestDescriptor | null>(null);
  const handledRefreshRevisionRef = useRef(refreshRevision);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const requestPage = useCallback(
    async ({
      generation,
      ...request
    }: HistoryRequestDescriptor & {
      generation: number;
    }) => {
      const { mode, cursor, requestQueryKey, q, tag } = request;
      requestRef.current?.abort();
      failedRequestRef.current = null;
      const controller = new AbortController();
      requestRef.current = controller;
      const requestSerial = requestSerialRef.current + 1;
      requestSerialRef.current = requestSerial;

      setState((current) => {
        if (current.queryKey !== requestQueryKey) return current;
        return mode === "reset"
          ? {
              ...emptyHistory<HistoryRecord>(requestQueryKey),
              loading: true
            }
          : { ...current, loading: true, error: "" };
      });

      try {
        const searchParams = new URLSearchParams({
          limit: String(JOURNAL_HISTORY_LIMIT)
        });
        if (q) searchParams.set("q", q);
        if (kind === "note" && tag) searchParams.set("tag", tag);
        if (cursor) searchParams.set("cursor", cursor);
        const result = await loadJournalHistoryRequest(kind, searchParams, controller.signal);

        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          queryKeyRef.current !== requestQueryKey ||
          requestSerialRef.current !== requestSerial
        ) {
          return;
        }
        failedRequestRef.current = null;
        setState((current) => {
          if (current.queryKey !== requestQueryKey) return current;
          const items =
            mode === "reset"
              ? result.items
              : mode === "reconcile"
                ? appendUnique(result.items, current.items)
                : appendUnique(current.items, result.items);
          return {
            queryKey: requestQueryKey,
            items,
            nextCursor:
              mode === "reconcile" && current.loaded
                ? current.nextCursor
                : result.nextCursor,
            totalCount: Math.max(result.totalCount, items.length),
            loaded: true,
            loading: false,
            error: ""
          };
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          queryKeyRef.current !== requestQueryKey ||
          requestSerialRef.current !== requestSerial
        ) {
          return;
        }
        failedRequestRef.current = request;
        setState((current) =>
          current.queryKey === requestQueryKey
            ? {
                ...current,
                loading: false,
                error:
                  error instanceof Error ? error.message : errorMessage
              }
            : current
        );
      }
    },
    [errorMessage, kind]
  );

  useEffect(() => {
    queryKeyRef.current = queryKey;
    generationRef.current += 1;
    const generation = generationRef.current;
    requestRef.current?.abort();
    if (failedRequestRef.current?.requestQueryKey !== queryKey) {
      failedRequestRef.current = null;
    }
    if (!active) {
      setState((current) =>
        current.loading ? { ...current, loading: false } : current
      );
      return;
    }

    const refreshRequested =
      handledRefreshRevisionRef.current !== refreshRevision;
    handledRefreshRevisionRef.current = refreshRevision;
    const current = stateRef.current;
    if (
      !refreshRequested &&
      current.queryKey === queryKey &&
      current.loaded
    ) {
      return;
    }

    const mode: HistoryRequestMode =
      refreshRequested &&
      current.queryKey === queryKey &&
      current.loaded
        ? "reconcile"
        : "reset";
    setState((accepted) =>
      mode === "reset"
        ? {
            ...emptyHistory<HistoryRecord>(queryKey),
            loading: true
          }
        : { ...accepted, loading: true, error: "" }
    );
    const timer = window.setTimeout(() => {
      void requestPage({
        mode,
        cursor: null,
        generation,
        requestQueryKey: queryKey,
        q: canonicalCriteria.q,
        tag: canonicalCriteria.tag
      });
    }, JOURNAL_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [
    active,
    canonicalCriteria.q,
    canonicalCriteria.tag,
    queryKey,
    refreshRevision,
    requestPage
  ]);

  const loadNext = useCallback(() => {
    if (!active) return;
    const current = stateRef.current;
    if (
      current.queryKey !== queryKeyRef.current ||
      current.loading ||
      (current.loaded && !current.nextCursor && !current.error)
    ) {
      return;
    }
    const reset = !current.loaded;
    void requestPage({
      mode: reset ? "reset" : "append",
      cursor: reset ? null : current.nextCursor,
      generation: generationRef.current,
      requestQueryKey: queryKeyRef.current,
      q: canonicalCriteria.q,
      tag: canonicalCriteria.tag
    });
  }, [
    active,
    canonicalCriteria.q,
    canonicalCriteria.tag,
    requestPage
  ]);

  const retry = useCallback(() => {
    if (!active) return;
    const failedRequest = failedRequestRef.current;
    if (
      !failedRequest ||
      failedRequest.requestQueryKey !== queryKeyRef.current
    ) {
      return;
    }
    void requestPage({
      ...failedRequest,
      generation: generationRef.current
    });
  }, [active, requestPage]);

  const visibleState =
    active && state.queryKey !== queryKey
      ? { ...emptyHistory<HistoryRecord>(queryKey), loading: true }
      : state;

  return {
    items: visibleState.items,
    nextCursor: visibleState.nextCursor,
    totalCount: visibleState.totalCount,
    loaded: visibleState.loaded,
    loading: visibleState.loading,
    error: visibleState.error,
    criteria,
    setCriteria,
    loadNext,
    retry,
    refresh: () => setRefreshRevision((current) => current + 1)
  };
}

function appendUnique<T extends { id: string }>(current: T[], next: T[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}
