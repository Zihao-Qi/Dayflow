import {
  applyPendingManagedRestore,
  runDueAutomaticBackup
} from "@/lib/backup-management";

/**
 * How often the process re-checks whether an Automatic Backup is due.
 *
 * Startup alone is not enough: a Dayflow left running for days would never
 * protect anything. The check itself is cheap and declines quickly when the
 * policy is off.
 */
const AUTOMATIC_BACKUP_CHECK_MS = 60 * 60 * 1000;

export async function registerNodeStartup() {
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.DAYFLOW_DISABLE_RESTORE === "1"
  ) {
    return;
  }

  try {
    await applyPendingManagedRestore();
  } catch (error) {
    console.error(
      "[Dayflow restore] Startup restore coordination failed; Dayflow will start without applying a pending restore.",
      error
    );
  }

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
