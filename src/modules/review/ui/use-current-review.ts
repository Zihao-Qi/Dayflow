"use client";

import { loadCurrentReviewWindow } from "@/components/dashboard-api";
import type { CurrentReviewWindow, Review } from "@/shared/client/decoders";
import { createReadGeneration } from "@/shared/client/read-generation";
import { useCallback, useEffect, useRef, useState } from "react";

export function useCurrentReview(todayKey: string) {
  const owner = useRef(createReadGeneration()).current;
  const [payload, setPayload] = useState<CurrentReviewWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      return await owner.run(loadCurrentReviewWindow, setPayload,
        () => setError("The current Review could not be loaded. Try again."),
        () => setLoading(false));
    } catch { return false; }
  }, [owner]);

  useEffect(() => {
    owner.invalidate();
    void refresh();
    return () => owner.invalidate();
  }, [todayKey, owner, refresh]);

  function acceptReview(review: Review) {
    owner.invalidate();
    setPayload((current) => current &&
      current.periodStart === review.periodStart && current.periodEnd === review.periodEnd
      ? { ...current, review } : current);
  }
  return { payload, loading, error, refresh, acceptReview };
}
