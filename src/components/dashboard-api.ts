import { request } from "@/shared/client/api-client";
import {
  isBootstrapResponse,
  isPastReviewDetail,
  isPersistedReviewResponse,
  isReviewHistoryPage,
  isReviewWindowDetail,
  isViewedDayPayload,
  type PastReviewDetail,
  type Review,
  type ReviewHistoryPage,
  type ReviewWindowDetail,
  type ViewedDayPayload
} from "@/shared/client/decoders";

const LIST_FAILURE = "Earlier reviews could not be loaded. Check that Dayflow is still running.";
const DETAIL_FAILURE = "That review could not be opened. Check that Dayflow is still running.";
const WINDOW_FAILURE = "That Review Window could not be opened. Check the date and try again.";
const LOAD_FAILURE = "That day could not be loaded. Check that Dayflow is still running.";
export function saveReview(payload: Omit<Review, "id" | "persisted">) {
  return request("/api/review", {
    method: "PUT",
    body: payload,
    decode: (result): result is Review & {
      id: string;
      persisted: true;
    } => !(!isPersistedReviewResponse(result) ||
      result.periodStart !== payload.periodStart ||
      result.periodEnd !== payload.periodEnd ||
      result.narrative !== payload.narrative ||
      result.nextPeriodIntention !== payload.nextPeriodIntention),
    fallback: "Review could not be saved.",
  });
}

export function loadReviewHistory(query: URLSearchParams) {
  return request(`/api/review/history?${query}`, {
    decode: (payload): payload is ReviewHistoryPage => !(!isReviewHistoryPage(payload)),
    fallback: LIST_FAILURE,
  });
}

export function loadReviewDetail(id: string) {
  return request(`/api/review/${encodeURIComponent(id)}`, {
    decode: (payload): payload is PastReviewDetail => !(!isPastReviewDetail(payload)),
    fallback: DETAIL_FAILURE,
  });
}

export function loadReviewWindow(query: URLSearchParams) {
  return request(`/api/review/window?${query}`, {
    decode: (payload): payload is ReviewWindowDetail => !(!isReviewWindowDetail(payload)),
    fallback: WINDOW_FAILURE,
  });
}

export function loadViewedDay(dayKey: string) {
  return request(`/api/day?date=${encodeURIComponent(dayKey)}`, {
    cache: "no-store",
    decode: (body): body is ViewedDayPayload => !(!isViewedDayPayload(body)),
    fallback: LOAD_FAILURE,
  });
}

export const GENERIC_BOOTSTRAP_FAILURE = "Dayflow could not open its local data. Check that the local server is running, then try again.";
export function loadBootstrap() {
  return request("/api/bootstrap", {
    cache: "no-store",
    decode: isBootstrapResponse,
    fallback: GENERIC_BOOTSTRAP_FAILURE,
    fallbackCode: "BOOTSTRAP_UNAVAILABLE",
    invalidMessage: "Dayflow received an invalid local data response. Try again.",
    invalidCode: "INVALID_BOOTSTRAP_RESPONSE"
  });
}
