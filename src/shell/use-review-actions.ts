"use client";

import { saveReview as saveReviewRequest } from "@/components/dashboard-api";
import { ApiError } from "@/shared/client/api-client";
import type { Review } from "@/shared/client/decoders";

import { type ShellState } from "./use-shell-state";

export function useReviewActions({
  setData,
  setAppAnnouncement,
  setAppError,
  reviewSaveWasInError,
  refresh,
  refreshAfterConfirmedMutation
}: Pick<
  ShellState,
  | "setData"
  | "setAppAnnouncement"
  | "setAppError"
  | "reviewSaveWasInError"
> & {
  refresh: () => Promise<void>;
  refreshAfterConfirmedMutation: () => Promise<boolean>;
}) {
  async function saveReview(review: Review) {
    const payload = {
      periodStart: review.periodStart,
      periodEnd: review.periodEnd,
      narrative: review.narrative.trim(),
      nextPeriodIntention: review.nextPeriodIntention.trim()
    };
    try {
      const result = await saveReviewRequest(payload);

      setData((current) =>
        current ? { ...current, review: result } : current
      );
      await refreshAfterConfirmedMutation();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "REVIEW_PERIOD_CHANGED") {
        try {
          await refresh();
          setAppAnnouncement(
            "The Review Period changed. A fresh Review is ready."
          );
          setAppError("");
          return true;
        } catch {
          setAppError(
            "The Review Period changed, but Dayflow could not load it. Reload to continue."
          );
          setAppAnnouncement("The new Review Period could not be loaded.");
          return false;
        }
      }
      return false;
    }
  }

  function reportReviewSaveFailure() {
    reviewSaveWasInError.current = true;
    setAppAnnouncement("Review was not saved.");
    setAppError(
      "Couldn’t save the review. Your writing is still here — retry."
    );
  }

  function reportReviewSaveRecovery() {
    if (!reviewSaveWasInError.current) return;
    reviewSaveWasInError.current = false;
    setAppAnnouncement("Saved.");
    setAppError("");
  }

  return { saveReview, reportReviewSaveFailure, reportReviewSaveRecovery };
}
