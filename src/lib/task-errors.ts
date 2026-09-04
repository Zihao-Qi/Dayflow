import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the task boundary. Property order is wire order. */
export const taskErrors = {
  theScheduleChangedBeforeItCouldBeUndone: {
    status: 409,
    message: "The schedule changed before it could be undone.",
    code: "CONFLICT"
  },
  taskNotFound: {
    status: 404,
    message: "Task not found.",
    code: "NOT_FOUND"
  },
  aRelatedRecordChangedBeforeTheTaskCouldBeSaved: {
    status: 409,
    message: "A related record changed before the task could be saved.",
    code: "CONFLICT"
  },
  taskCouldNotBeDeleted: {
    status: 500,
    message: "Task could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  taskCouldNotBeSaved: {
    status: 500,
    message: "Task could not be saved.",
    code: "INTERNAL_ERROR"
  },
  taskNotFoundidNOTFOUND: {
    status: 404,
    message: "Task not found.",
    code: "NOT_FOUND",
    field: "id"
  },
  thereIsNoScheduleChangeToUndo: {
    status: 404,
    message: "There is no schedule change to undo.",
    code: "NOT_FOUND",
    field: "scheduleChange"
  },
  theScheduleChangeCouldNotBeUndone: {
    status: 500,
    message: "The schedule change could not be undone.",
    code: "INTERNAL_ERROR"
  },
  oneOrMoreTasksCouldNotBeFound: {
    status: 404,
    message: "One or more tasks could not be found.",
    code: "NOT_FOUND",
    field: "ids"
  },
  aTaskChangedBeforeItsOrderCouldBeSaved: {
    status: 409,
    message: "A task changed before its order could be saved.",
    code: "CONFLICT"
  },
  taskOrderCouldNotBeSaved: {
    status: 500,
    message: "Task order could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theSelectedTaskRelationshipIsNoLongerAvailable: {
    status: 409,
    message: "The selected task relationship is no longer available.",
    code: "CONFLICT"
  },
  taskCouldNotBeCreated: {
    status: 500,
    message: "Task could not be created.",
    code: "INTERNAL_ERROR"
  },
  estimateMustBeAWholeNumberFrom0To1440Minutes: {
    status: 400,
    message: "Estimate must be a whole number from 0 to 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "estimateMinutes"
  },
  taskStatusIsInvalid: {
    status: 400,
    message: "Task status is invalid.",
    code: "VALIDATION_ERROR",
    field: "status"
  },
  taskIdentifierIsInvalid: {
    status: 400,
    message: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  taskIdentifiersMustNotContainDuplicates: {
    status: 400,
    message: "Task identifiers must not contain duplicates.",
    code: "VALIDATION_ERROR",
    field: "ids"
  },
  scheduledDateIsInvalid: {
    status: 400,
    message: "Scheduled date is invalid.",
    code: "VALIDATION_ERROR",
    field: "date"
  },
  taskPriorityIsInvalid: {
    status: 400,
    message: "Task priority is invalid.",
    code: "VALIDATION_ERROR",
    field: "priority"
  },
  urgencyScoreMustBeAWholeNumberFrom1To5: {
    status: 400,
    message: "Urgency score must be a whole number from 1 to 5.",
    code: "VALIDATION_ERROR",
    field: "urgentScore"
  },
  importanceScoreMustBeAWholeNumberFrom1To5: {
    status: 400,
    message: "Importance score must be a whole number from 1 to 5.",
    code: "VALIDATION_ERROR",
    field: "importanceScore"
  },
  deadlineIsInvalid: {
    status: 400,
    message: "Deadline is invalid.",
    code: "VALIDATION_ERROR",
    field: "deadline"
  },
  actualMinutesMustBeANonnegativeWholeNumber: {
    status: 400,
    message: "Actual minutes must be a non-negative whole number.",
    code: "VALIDATION_ERROR",
    field: "actualMinutes"
  },
  taskOrderMustBeANonnegativeWholeNumber: {
    status: 400,
    message: "Task order must be a non-negative whole number.",
    code: "VALIDATION_ERROR",
    field: "sortOrder"
  },
  taskTitleIsRequired: {
    status: 400,
    message: "Task title is required.",
    code: "VALIDATION_ERROR",
    field: "title"
  },
  scheduleSourceIsInvalid: {
    status: 400,
    message: "Schedule source is invalid.",
    code: "VALIDATION_ERROR",
    field: "scheduleSource"
  }
} as const satisfies Record<string, ErrorSpec>;
