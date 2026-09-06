"use client";

import { loadCurrentReviewWindow } from "@/components/dashboard-api";
import type { CurrentReviewWindow, Review } from "@/shared/client/decoders";
import { createReadGeneration } from "@/shared/client/read-generation";
import { useCallback, useEffect, useRef, useState } from "react";

export function useCurrentReview(todayKey: string) {
  const owner = useRef(createReadGeneration()).current;
  const [loaded, setLoaded] = useState<{ key: string; window: CurrentReviewWindow } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      return await owner.run(loadCurrentReviewWindow,
        (window) => setLoaded({ key: todayKey, window }),
        () => setError("The current Review could not be loaded. Try again."),
        () => setLoading(false));
    } catch { return false; }
  }, [owner, todayKey]);

  useEffect(() => {
    owner.invalidate();
    void refresh();
    return () => owner.invalidate();
  }, [todayKey, owner, refresh]);

  function acceptReview(review: Review) {
    owner.invalidate();
    setLoaded((current) => current &&
      current.window.periodStart === review.periodStart && current.window.periodEnd === review.periodEnd
      ? { ...current, window: { ...current.window, review } } : current);
  }
  // Only a window read taken for the calendar day now in effect may be shown. A
  // failed read on the same day keeps what is on screen; a failed read after
  // rollover must not leave the previous period's editor open.
  const payload = loaded && loaded.key === todayKey ? loaded.window : null;
  return { payload, loading, error, refresh, acceptReview };
}
