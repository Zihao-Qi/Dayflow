import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the review boundary. Property order is wire order. */
export const reviewErrors = {
  reviewPeriodEndMustBeAfterItsStart: {
    status: 400,
    message: "Review Period end must be after its start.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  reviewPeriodStartMustBeLocalMidnight: {
    status: 400,
    message: "Review Period start must be local midnight.",
    code: "VALIDATION_ERROR",
    field: "periodStart"
  },
  reviewPeriodEndMustBeLocalMidnight: {
    status: 400,
    message: "Review Period end must be local midnight.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  reviewPeriodMustSpanExactlySevenLocalDays: {
    status: 400,
    message: "Review Period must span exactly seven local days.",
    code: "VALIDATION_ERROR",
    field: "periodEnd"
  },
  writeANarrativeOrNextperiodIntentionBeforeSavingThisReview: {
    status: 400,
    message: "Write a narrative or next-period intention before saving this Review.",
    code: "VALIDATION_ERROR",
    field: "review"
  },
  theReviewPeriodChangedRefreshAndTryAgain: {
    status: 409,
    message: "The Review Period changed. Refresh and try again.",
    code: "REVIEW_PERIOD_CHANGED",
    field: "reviewPeriod"
  },
  aReviewWindowEndingDayMustBeACalendarDateSuch: {
    status: 400,
    message: "A Review Window ending day must be a calendar date such as 2026-08-31.",
    code: "VALIDATION_ERROR"
  },
  thatReviewWindowEndingDayIsNotARealCalendarDate: {
    status: 400,
    message: "That Review Window ending day is not a real calendar date.",
    code: "VALIDATION_ERROR"
  },
  reviewWindowsMustEndBeforeToday: {
    status: 400,
    message: "Review Windows must end before today.",
    code: "VALIDATION_ERROR"
  },
  provideOnlyOnePageLimit: {
    status: 400,
    message: "Provide only one page limit.",
    code: "VALIDATION_ERROR"
  },
  pageLimitMustBeAWholeNumberBetween1And100: {
    status: 400,
    message: "Page limit must be a whole number between 1 and 100.",
    code: "VALIDATION_ERROR"
  },
  provideOnlyOnePaginationCursor: {
    status: 400,
    message: "Provide only one pagination cursor.",
    code: "INVALID_CURSOR"
  },
  thatPaginationCursorIsNoLongerUsableReloadReviewHistory: {
    status: 400,
    message: "That pagination cursor is no longer usable. Reload Review history.",
    code: "INVALID_CURSOR"
  },
  thatReviewIdentifierIsNotValid: {
    status: 400,
    message: "That Review identifier is not valid.",
    code: "VALIDATION_ERROR"
  },
  thatReviewNoLongerExists: {
    status: 404,
    message: "That Review no longer exists.",
    code: "REVIEW_NOT_FOUND"
  },
  reviewPeriodCouldNotBeRead: {
    status: 500,
    message: "Review period could not be read.",
    code: "INTERNAL_ERROR"
  },
  reviewHistoryCouldNotBeRead: {
    status: 500,
    message: "Review history could not be read.",
    code: "INTERNAL_ERROR"
  },
  reviewCouldNotBeSaved: {
    status: 500,
    message: "Review could not be saved.",
    code: "INTERNAL_ERROR"
  },
  reviewWindowCouldNotBeRead: {
    status: 500,
    message: "Review Window could not be read.",
    code: "INTERNAL_ERROR"
  },
  multipleWindowEndingDays: {
    status: 400,
    message: "Provide only one Review Window ending day.",
    code: "VALIDATION_ERROR"
  },
  windowEndingDayRequired: {
    status: 400,
    message: "Choose a Review Window ending day.",
    code: "VALIDATION_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
