import { systemClock } from "@/shared/kernel/calendar";
import type { AutomaticBackupState } from "@/lib/automatic-backup-contract";
import {
  type ManagedBackupSummary,
  type BackupManagementOptions,
  resolveBackupContext,
  listBackupFiles,
  withOperation,
  createManagedBackupArtifact,
  verifiedSummary
} from "./managed-backup-storage";
import { automaticStateFor } from "./backup-policy";
import { restoreStateFor } from "./restore-coordinator";

export type ManagedBackupIndex = {
  directory: string;
  automatic: AutomaticBackupState;
  backups: ManagedBackupSummary[];
  pendingRestore: Record<string, unknown> | null;
  lastRestore: Record<string, unknown> | null;
};

export function getManagedBackupIndex(
  options: BackupManagementOptions = {}
): ManagedBackupIndex {
  const context = resolveBackupContext(options, "read");
  const backups = listBackupFiles(context);
  return {
    directory: context.directory,
    automatic: automaticStateFor(context, backups, options.now ?? (options.clock ?? systemClock).now()),
    backups,
    ...restoreStateFor(context)
  };
}

export function createManagedBackup(
  options: BackupManagementOptions = {}
): ManagedBackupSummary {
  return withOperation(() => {
    const context = resolveBackupContext(options, "mutation");
    const now = options.now ?? (options.clock ?? systemClock).now();
    const result = createManagedBackupArtifact(context, "manual", now);
    return verifiedSummary(result.destinationPath);
  });
}
