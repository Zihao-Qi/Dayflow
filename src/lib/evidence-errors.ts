import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the evidence boundary. Property order is wire order. */
export const evidenceErrors = {
  activityNotFound: {
    status: 404,
    message: "Activity not found.",
    code: "ACTIVITY_NOT_FOUND"
  },
  focusEvidenceCannotBeEditedHere: {
    status: 409,
    message: "Focus evidence cannot be edited here.",
    code: "FOCUS_ACTIVITY_PROTECTED"
  },
  theActivityChangedBeforeItCouldBeUpdated: {
    status: 409,
    message: "The Activity changed before it could be updated.",
    code: "CONFLICT"
  },
  theLinkedTaskCouldNotBeFound: {
    status: 404,
    message: "The linked task could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "taskId"
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    message: "The selected task belongs to a different project.",
    code: "ATTRIBUTION_CONFLICT",
    field: "projectId"
  },
  theLinkedProjectCouldNotBeFound: {
    status: 404,
    message: "The linked project could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "projectId"
  },
  activityDateIsInvalid: {
    status: 400,
    message: "Activity date is invalid.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  activityDateCannotBeInTheFuture: {
    status: 400,
    message: "Activity date cannot be in the future.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  activityStartTimeIsInvalid: {
    status: 400,
    message: "Activity start time is invalid.",
    code: "VALIDATION_ERROR",
    field: "startTime"
  },
  theActivityChangedBeforeItCouldBeDeleted: {
    status: 409,
    message: "The Activity changed before it could be deleted.",
    code: "CONFLICT"
  },
  activityDeleteNotFound: {
    status: 404,
    message: "Activity not found."
  },
  focusEvidenceCannotBeDeleted: {
    status: 409,
    message: "Focus evidence cannot be deleted."
  },
  activityCouldNotBeDeleted: {
    status: 500,
    message: "Activity could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  diaryCouldNotBeSaved: {
    status: 500,
    message: "Diary could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theLinkedActivityRelationshipIsNoLongerAvailable: {
    status: 409,
    message: "The linked Activity relationship is no longer available.",
    code: "RELATIONSHIP_CONFLICT"
  },
  activityCreateFailed: {
    status: 500,
    message: "Activity could not be saved.",
    code: "INTERNAL_ERROR"
  },
  activityReplaceFailed: {
    status: 500,
    message: "Activity could not be updated.",
    code: "INTERNAL_ERROR"
  },
  activityIdentifierIsInvalid: {
    status: 400,
    message: "Activity identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  diaryDateMustBeAValidCalendarDate: {
    status: 400,
    message: "Diary date must be a valid calendar date.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  durationMustBeBetween1And1440Minutes: {
    status: 400,
    message: "Duration must be between 1 and 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "durationMinutes"
  },
  activityCategoryMustBeText: {
    status: 400,
    message: "Activity category must be text.",
    code: "VALIDATION_ERROR",
    field: "category"
  },
  addAShortNoteAboutWhatHappened: {
    status: 400,
    message: "Add a short note about what happened.",
    code: "VALIDATION_ERROR",
    field: "note"
  }
} as const satisfies Record<string, ErrorSpec>;
