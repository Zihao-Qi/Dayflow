import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the backup boundary. Property order is wire order. */
export const backupErrors = {
  thisLocalDataActionRequiresAnExplicitDayflowRequest: {
    status: 403,
    message: "This local data action requires an explicit Dayflow request.",
    code: "FORBIDDEN"
  },
  useApplicationjsonForLocalDataActions: {
    status: 415,
    message: "Use application/json for local data actions.",
    code: "UNSUPPORTED_MEDIA_TYPE"
  },
  crossoriginLocalDataActionsAreNotAllowed: {
    status: 403,
    message: "Cross-origin local data actions are not allowed.",
    code: "FORBIDDEN"
  },
  theRequestBodyMustBeValidJSON: {
    status: 400,
    message: "The request body must be valid JSON.",
    code: "INVALID_JSON"
  },
  theRequestBodyMustBeAJSONObject: {
    status: 400,
    message: "The request body must be a JSON object.",
    code: "VALIDATION_ERROR"
  },
  crosssiteLocalDataRequestsAreNotAllowed: {
    status: 403,
    message: "Cross-site local data requests are not allowed.",
    code: "FORBIDDEN"
  },
  typeRESTOREExactlyToScheduleReplacement: {
    status: 400,
    message: "Type RESTORE exactly to schedule replacement.",
    code: "VALIDATION_ERROR",
    field: "confirmation"
  },
  theSelectedBackupChecksumIsInvalid: {
    status: 400,
    message: "The selected backup checksum is invalid.",
    code: "VALIDATION_ERROR",
    field: "expectedPayloadSha256"
  },
  anotherRestoreIsAlreadyPending: {
    status: 409,
    message: "Another restore is already pending.",
    code: "CONFLICT"
  },
  theSelectedBackupChangedAfterItWasInspectedRefreshAndTry: {
    status: 409,
    message: "The selected backup changed after it was inspected. Refresh and try again.",
    code: "CONFLICT",
    field: "expectedPayloadSha256"
  },
  noRestoreIsCurrentlyPending: {
    status: 404,
    message: "No restore is currently pending.",
    code: "NOT_FOUND"
  },
  theScheduledBackupChangedBeforeStartupAndWasNotRestored: {
    status: 409,
    message: "The scheduled backup changed before startup and was not restored.",
    code: "CONFLICT"
  },
  theManagedBackupLocationIsNotASafeDirectory: {
    status: 409,
    message: "The managed backup location is not a safe directory.",
    code: "CONFLICT"
  },
  theSelectedBackupIsCorruptOrIncompatibleAndCannotBeRestored: {
    status: 422,
    message: "The selected backup is corrupt or incompatible and cannot be restored.",
    code: "CORRUPT_BACKUP",
    field: "backupId"
  },
  theBackupIdentifierIsInvalid: {
    status: 400,
    message: "The backup identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "backupId"
  },
  theSelectedBackupCouldNotBeFound: {
    status: 404,
    message: "The selected backup could not be found.",
    code: "NOT_FOUND",
    field: "backupId"
  },
  restoreSchedulingIsDisabledInThisDayflowProcess: {
    status: 503,
    message: "Restore scheduling is disabled in this Dayflow process.",
    code: "RESTORE_DISABLED"
  },
  anotherBackupOperationIsAlreadyRunning: {
    status: 409,
    message: "Another backup operation is already running.",
    code: "CONFLICT"
  },
  automaticBackupsMustBeExplicitlyTurnedOnOrOff: {
    status: 400,
    message: "Automatic backups must be explicitly turned on or off.",
    code: "VALIDATION_ERROR",
    field: "enabled"
  },
  cancelingARestoreDoesNotAcceptAnyFields: {
    status: 400,
    message: "Canceling a restore does not accept any fields.",
    code: "VALIDATION_ERROR"
  },
  backupCreationDoesNotAcceptADestinationPath: {
    status: 400,
    message: "Backup creation does not accept a destination path.",
    code: "VALIDATION_ERROR"
  },
  backupListFailed: {
    status: 500,
    message: "Backup list could not be completed.",
    code: "INTERNAL_ERROR"
  },
  backupCreationFailed: {
    status: 500,
    message: "Backup creation could not be completed.",
    code: "INTERNAL_ERROR"
  },
  automaticBackupSettingsFailed: {
    status: 500,
    message: "Automatic backup settings could not be completed.",
    code: "INTERNAL_ERROR"
  },
  backupDownloadFailed: {
    status: 500,
    message: "Backup download could not be completed.",
    code: "INTERNAL_ERROR"
  },
  restoreSchedulingFailed: {
    status: 500,
    message: "Restore scheduling could not be completed.",
    code: "INTERNAL_ERROR"
  },
  restoreCancellationFailed: {
    status: 500,
    message: "Restore cancellation could not be completed.",
    code: "INTERNAL_ERROR"
  },
  operationFailed: {
    status: 500,
    message: "Backup operation could not be completed.",
    code: "INTERNAL_ERROR"
  },
  chooseAManagedBackup: {
    status: 400,
    message: "Choose a managed backup.",
    code: "VALIDATION_ERROR",
    field: "backupId"
  },
  theSelectedBackupChecksumIsRequired: {
    status: 400,
    message: "The selected backup checksum is required.",
    code: "VALIDATION_ERROR",
    field: "expectedPayloadSha256"
  },
  theBackupIntervalInHoursMustBeAWholeNumberBetween: {
    status: 400,
    message: "The backup interval in hours must be a whole number between 1 and 168.",
    code: "VALIDATION_ERROR",
    field: "intervalHours"
  },
  theBackupIntervalInHours: {
    status: 400,
    message: "The backup interval in hours",
    code: "VALIDATION_ERROR",
    field: "intervalHours"
  },
  theNumberOfAutomaticBackupsToKeep: {
    status: 400,
    message: "The number of automatic backups to keep",
    code: "VALIDATION_ERROR",
    field: "retainCount"
  }
} as const satisfies Record<string, ErrorSpec>;
