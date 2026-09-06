// Compatibility surface; transaction roots live in the server adapter.
export {
  REVIEW_HISTORY_DEFAULT_LIMIT, REVIEW_HISTORY_MAX_LIMIT, ReviewHistoryRequestError,
  parseReviewWindowRequest, parseReviewHistoryPage, encodeReviewCursor, decodeReviewCursor,
  isReviewIdentifier, type ReviewHistoryErrorCode, type ReviewPeriodInterval,
  type ReviewCursor, type ReviewWindowRequest
} from "@/modules/review/domain/review";
export {
  readReviewPeriodEvidence, readReviewWindow, readCurrentReviewWindow, readResolvedReviewWindow,
  readReviewHistoryPage, readPastReviewPeriod
} from "@/server/review";
