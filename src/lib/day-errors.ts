import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the day boundary. The serializer emits exactly the declared properties. */
export const dayErrors = {
  provideOnlyOneDay: {
    status: 400,
    message: "Provide only one day.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  aDayMustBeACalendarDateSuchAs20260823: {
    status: 400,
    message: "A day must be a calendar date such as 2026-08-23.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  thatDayIsNotARealCalendarDate: {
    status: 400,
    message: "That day is not a real calendar date.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  dayflowPlansUpTo8WeeksAhead: {
    status: 400,
    message: "Dayflow plans up to 8 weeks ahead.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  thatDayIsEarlierThanDayflowsFirstRecordedEvidence: {
    status: 400,
    message: "That day is earlier than Dayflow's first recorded evidence.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  thatDayCouldNotBeRead: {
    status: 500,
    message: "That day could not be read.",
    code: "INTERNAL_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
