/** Compatibility exports; all managed backup behavior is owned by data-ops. */
export type { AutomaticBackupAttempt, AutomaticBackupState } from "@/lib/automatic-backup-contract";
export {
  BackupManagementError,
  isValidBackupId,
  type BackupManagementOptions,
  type ManagedBackupSummary
} from "@/modules/data-ops/services/managed-backup-storage";
export {
  createManagedBackup,
  getManagedBackupIndex,
  type ManagedBackupIndex
} from "@/modules/data-ops/services/managed-backups";
export {
  getAutomaticBackupState,
  setAutomaticBackupPolicy
} from "@/modules/data-ops/services/backup-policy";
export { runDueAutomaticBackup } from "@/modules/data-ops/services/automatic-backup-runner";
export {
  stageManagedRestore,
  cancelManagedRestore,
  resolveManagedBackupDownload,
  applyPendingManagedRestore,
  type PendingRestore,
  type RestoreStatus
} from "@/modules/data-ops/services/restore-coordinator";
