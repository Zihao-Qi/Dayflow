"use client";

import type { JournalHistoryState } from "@/components/use-journal-evidence-history";

export function HistoryFooter<T>({
  noun,
  state,
  onLoadMore,
  onRetry
}: {
  noun: string;
  state: JournalHistoryState<T>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (state.error) {
    return (
      <div className="history-status" role="alert">
        <span>{state.error}</span>
        <button className="secondary-button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (state.loading) {
    return (
      <p className="history-status" role="status">
        Loading {noun}…
      </p>
    );
  }
  if (state.nextCursor) {
    return (
      <div className="history-status">
        <span>
          Showing {state.items.length}
          {state.totalCount === null ? "" : ` of ${state.totalCount}`} {noun}
        </span>
        <button className="secondary-button" onClick={onLoadMore}>
          Load more
        </button>
      </div>
    );
  }
  if (state.loaded && state.totalCount !== null) {
    return (
      <p className="history-status" role="status">
        All {state.totalCount} {noun} loaded.
      </p>
    );
  }
  return null;
}
