import {
  isAutomaticBackupState,
  type AutomaticBackupPolicy,
  type AutomaticBackupState
} from "@/lib/automatic-backup-contract";
import { parseCsvExportResponseMetadata, type CsvExportKind } from "@/lib/csv-export-contract";
import { request } from "@/shared/client/api-client";
import {
  backupCanRestore,
  isBackupCreateResponse,
  isBackupIndex,
  isPendingRestoreFor,
  type BackupIndex,
  type BackupRecord
} from "./backup-model";

export function loadBackups() {
  return request("/api/backups", {
    cache: "no-store",
    decode: (result): result is BackupIndex => isBackupIndex(result),
    fallback: "Backups could not be loaded.",
    invalidMessage: "Dayflow returned an invalid backup list.",
  });
}

export function createBackup() {
  return request("/api/backups", {
    method: "POST",
    body: {},
    localAction: true,
    decode: (result): result is {
      backup: BackupRecord;
    } => isBackupCreateResponse(result) &&
      backupCanRestore(result.backup),
    fallback: "The backup could not be created.",
    invalidMessage: "Dayflow returned an invalid backup result. Refresh before relying on this backup.",
  });
}

export function saveAutomaticPolicy(policy: AutomaticBackupPolicy) {
  return request("/api/backups/automatic", {
    method: "PUT",
    body: policy,
    localAction: true,
    decode: (result): result is AutomaticBackupState => isAutomaticBackupState(result),
    fallback: "Automatic backups could not be updated.",
    invalidMessage: "Dayflow returned invalid automatic backup settings.",
  });
}

export function stageRestore(backupId: string, expectedPayloadSha256: string) {
  return request("/api/backups/restore", {
    method: "POST",
    body: {
      backupId: backupId,
      expectedPayloadSha256,
      confirmation: "RESTORE"
    },
    localAction: true,
    decode: (result): result is BackupIndex => isBackupIndex(result) &&
      isPendingRestoreFor(result.pendingRestore, backupId, expectedPayloadSha256),
    fallback: "The restore could not be scheduled.",
    invalidMessage: "Dayflow returned an invalid restore result. Refresh before trying again.",
  });
}

export function cancelRestore() {
  return request("/api/backups/restore", {
    method: "DELETE",
    body: {},
    localAction: true,
    decode: (result): result is BackupIndex => isBackupIndex(result) &&
      result.pendingRestore === null,
    fallback: "The pending restore could not be canceled.",
    invalidMessage: "Dayflow returned an invalid cancellation result. Refresh before relying on this status.",
  });
}

export function downloadCsv(kind: CsvExportKind) {
  const label = kind === "tasks" ? "Task" : "Activity";
  return request(`/api/exports/${kind}`, {
    cache: "no-store",
    responseType: "blob",
    decode: (headers: Headers) => parseCsvExportResponseMetadata(kind, headers),
    fallback: `${label} CSV could not be downloaded.`,
    invalidMessage: `Dayflow returned an invalid ${label} CSV. Try again.`
  });
}
