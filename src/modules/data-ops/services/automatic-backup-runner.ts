import { systemClock } from "@/shared/kernel/calendar";
import type { AutomaticBackupAttempt } from "@/lib/automatic-backup-contract";
import { basename } from "node:path";
import {
  type BackupManagementOptions,
  type BackupContext,
  resolveBackupContext,
  listBackupFiles,
  isBackupOperationInProgress,
  withOperation,
  createManagedBackupArtifact,
  MAX_PERSISTED_ERROR_LENGTH
} from "./managed-backup-storage";
import { automaticStateFor, recordAutomaticAttempt } from "./backup-policy";
import { restoreIsInFlight } from "./restore-coordinator";

/**
 * Create an Automatic Backup if one is due.
 *
 * This is the unattended path, so it declines rather than forces: a disabled
 * policy, a pending restore, or another operation already running all mean
 * "not now". Nothing here deletes an artifact.
 */
export function runDueAutomaticBackup(
  options: BackupManagementOptions = {}
): AutomaticBackupAttempt {
  const now = options.now ?? (options.clock ?? systemClock).now();
  let context: BackupContext;
  try {
    context = resolveBackupContext(options, "read");
  } catch (error) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: describeAutomaticFailure(error)
    };
  }

  const state = automaticStateFor(context, listBackupFiles(context), now);
  if (!state.policy.enabled) {
    return { status: "skipped", at: now.toISOString(), reason: "disabled" };
  }
  if (!state.schedule.due) {
    return { status: "skipped", at: now.toISOString(), reason: "not due" };
  }
  if (restoreIsInFlight(context)) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: "a restore is pending"
    };
  }
  if (isBackupOperationInProgress()) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: "another backup operation is running"
    };
  }

  let attempt: AutomaticBackupAttempt;
  try {
    attempt = withOperation(() => {
      const mutable = resolveBackupContext(options, "mutation");
      const result = createManagedBackupArtifact(mutable, "automatic", now);
      return {
        status: "succeeded" as const,
        at: now.toISOString(),
        fileName: basename(result.destinationPath)
      };
    });
  } catch (error) {
    attempt = {
      status: "failed",
      at: now.toISOString(),
      reason: describeAutomaticFailure(error)
    };
  }

  recordAutomaticAttempt(context, attempt);
  return attempt;
}

function describeAutomaticFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_PERSISTED_ERROR_LENGTH);
}

/**
 * How often the process re-checks whether an Automatic Backup is due.
 *
 * Startup alone is not enough: a Dayflow left running for days would never
 * protect anything. The check itself is cheap and declines quickly when the
 * policy is off.
 */
const AUTOMATIC_BACKUP_CHECK_MS = 60 * 60 * 1000;

/** Start background protection only after startup restore coordination finishes. */
export function startAutomaticBackupRunner() {
  checkAutomaticBackup();
  const timer = setInterval(checkAutomaticBackup, AUTOMATIC_BACKUP_CHECK_MS);
  timer.unref?.();
}

/**
 * An Automatic Backup is background protection, never a gate: a failure here
 * must leave Dayflow serving normally.
 */
function checkAutomaticBackup() {
  try {
    const attempt = runDueAutomaticBackup();
    if (attempt.status === "failed") {
      console.error(
        `[Dayflow backup] The automatic backup did not complete: ${attempt.reason}`
      );
    }
  } catch (error) {
    console.error(
      "[Dayflow backup] The automatic backup check failed; Dayflow will continue without it.",
      error
    );
  }
}
