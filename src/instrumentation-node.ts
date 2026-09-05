import { applyPendingManagedRestore } from "@/modules/data-ops/services/restore-coordinator";
import { startAutomaticBackupRunner } from "@/modules/data-ops/services/automatic-backup-runner";

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

  startAutomaticBackupRunner();
}
