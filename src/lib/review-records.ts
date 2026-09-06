// Client decoders for Review responses the browser has already received.
// Named exports, never `export *`: the name must stay pinned to the client
// decoder, which rejects window geometry drift and unpersisted drafts. The
// server's own contract (which admits drafts) lives in
// @/modules/review/domain/review and is a different guard with the same name.
export {
  isPastReviewDetail,
  isPastReviewProject,
  isPastReviewRecord,
  isPastReviewSummary,
  isReviewHistoryPage,
  isReviewWindowDetail
} from "@/shared/client/decoders";
export type {
  PastReviewDetail,
  PastReviewProject,
  PastReviewRecord,
  PastReviewSummary,
  ReviewHistoryPage,
  ReviewWindowDetail
} from "@/shared/client/decoders";
