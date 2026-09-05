import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the project boundary. Property order is wire order. */
export const projectErrors = {
  completionConfirmationMustBeTrueOrFalse: {
    status: 400,
    message: "Completion confirmation must be true or false.",
    code: "VALIDATION_ERROR",
    field: "confirm"
  },
  aTaskCannotHaveAPhaseWithoutAProject: {
    status: 400,
    message: "A task cannot have a phase without a project.",
    code: "VALIDATION_ERROR",
    field: "phaseId"
  },
  theSelectedProjectCouldNotBeFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "projectId"
  },
  reopenTheCompletedProjectBeforeAddingUnfinishedWork: {
    status: 409,
    message: "Reopen the completed project before adding unfinished work.",
    code: "RELATIONSHIP_CONFLICT",
    field: "projectId"
  },
  theSelectedPhaseCouldNotBeFound: {
    status: 404,
    message: "The selected phase could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "phaseId"
  },
  theSelectedPhaseDoesNotBelongToThisProject: {
    status: 409,
    message: "The selected phase does not belong to this project.",
    code: "RELATIONSHIP_CONFLICT",
    field: "phaseId"
  },
  phaseParentNotFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "NOT_FOUND",
    field: "projectId"
  },
  phaseNotFound: {
    status: 404,
    message: "Phase not found.",
    code: "NOT_FOUND"
  },
  phaseCouldNotBeDeleted: {
    status: 500,
    message: "Phase could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  phaseCouldNotBeSaved: {
    status: 500,
    message: "Phase could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theSelectedProjectIsNoLongerAvailable: {
    status: 409,
    message: "The selected Project is no longer available.",
    code: "CONFLICT",
    field: "projectId"
  },
  phaseCouldNotBeCreated: {
    status: 500,
    message: "Phase could not be created.",
    code: "INTERNAL_ERROR"
  },
  projectDetailNotFound: {
    status: 404,
    message: "Project not found."
  },
  confirmCompletionWhileUnfinishedTasksRemain: {
    status: 409,
    message: "Confirm completion while unfinished tasks remain.",
    code: "CONFLICT",
    field: "status",
    requiresConfirmation: true
  },
  projectDeletionRequiresConfirmation: {
    status: 400,
    message: "Project deletion requires confirmation.",
    code: "VALIDATION_ERROR",
    field: "confirm"
  },
  projectNotFound: {
    status: 404,
    message: "Project not found.",
    code: "NOT_FOUND"
  },
  aRelatedRecordChangedBeforeTheProjectCouldBeSaved: {
    status: 409,
    message: "A related record changed before the Project could be saved.",
    code: "CONFLICT"
  },
  projectCouldNotBeDeleted: {
    status: 500,
    message: "Project could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  projectCouldNotBeSaved: {
    status: 500,
    message: "Project could not be saved.",
    code: "INTERNAL_ERROR"
  },
  aRelatedRecordChangedBeforeTheProjectCouldBeCreated: {
    status: 409,
    message: "A related record changed before the Project could be created.",
    code: "CONFLICT"
  },
  projectCouldNotBeCreated: {
    status: 500,
    message: "Project could not be created.",
    code: "INTERNAL_ERROR"
  },
  weeklyEffortBudgetMustBeAWholeNumberFrom1To: {
    status: 400,
    message: "Weekly effort budget must be a whole number from 1 to 10080 minutes.",
    code: "VALIDATION_ERROR",
    field: "weeklyMinutesBudget"
  },
  projectIdentifierIsInvalid: {
    status: 400,
    message: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  phaseOrderMustBeAWholeNumberFrom0To2147483647: {
    status: 400,
    message: "Phase order must be a whole number from 0 to 2147483647.",
    code: "VALIDATION_ERROR",
    field: "sortOrder"
  },
  phaseIdentifierIsInvalid: {
    status: 400,
    message: "Phase identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  projectIdentifierIsInvalidprojectId: {
    status: 400,
    message: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "projectId"
  },
  phaseNameIsRequired: {
    status: 400,
    message: "Phase name is required.",
    code: "VALIDATION_ERROR",
    field: "name"
  },
  targetDateIsInvalid: {
    status: 400,
    message: "Target date is invalid.",
    code: "VALIDATION_ERROR",
    field: "targetDate"
  },
  targetDurationMustBeAWholeNumberFrom1To10000: {
    status: 400,
    message: "Target duration must be a whole number from 1 to 10000.",
    code: "VALIDATION_ERROR",
    field: "targetDurationValue"
  },
  targetDurationUnitMustBeDAYSOrWEEKS: {
    status: 400,
    message: "Target duration unit must be DAYS or WEEKS.",
    code: "VALIDATION_ERROR",
    field: "targetDurationUnit"
  },
  projectStatusIsInvalid: {
    status: 400,
    message: "Project status is invalid.",
    code: "VALIDATION_ERROR",
    field: "status"
  }
} as const satisfies Record<string, ErrorSpec>;
