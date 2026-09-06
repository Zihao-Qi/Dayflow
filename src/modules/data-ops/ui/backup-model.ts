"use client";

import { isAutomaticBackupState, type AutomaticBackupState } from "@/lib/automatic-backup-contract";

export type BackupRecord = {
  id: string;
  fileName: string;
  path: string;
  createdAt: string | null;
  applicationVersion: string | null;
  schemaVersion: string | null;
  sizeBytes: number;
  payloadBytes: number | null;
  payloadSha256: string | null;
  totalRecords: number | null;
  recordCounts: Record<string, number>;
  status: "verified" | "invalid";
  error?: string;
};

export type RestoreStatus = Record<string, unknown>;

export type BackupIndex = {
  directory: string;
  automatic: AutomaticBackupState;
  backups: BackupRecord[];
  pendingRestore: RestoreStatus | null;
  lastRestore: RestoreStatus | null;
};

export type BusyAction =
  | "loading"
  | "creating"
  | "staging"
  | "canceling"
  | "scheduling";

export function isBackupCreateResponse(
  value: unknown
): value is { backup: BackupRecord } {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    isBackupRecord(value.backup)
  );
}

export function isBackupIndex(value: unknown): value is BackupIndex {
  if (!isObject(value)) return false;
  return (
    typeof value.directory === "string" &&
    isAutomaticBackupState(value.automatic) &&
    Array.isArray(value.backups) &&
    value.backups.every(isBackupRecord) &&
    (value.pendingRestore === null || isObject(value.pendingRestore)) &&
    (value.lastRestore === null || isObject(value.lastRestore))
  );
}

export function isBackupRecord(value: unknown): value is BackupRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.fileName === "string" &&
    typeof value.path === "string" &&
    (value.createdAt === null || typeof value.createdAt === "string") &&
    (value.applicationVersion === null ||
      typeof value.applicationVersion === "string") &&
    (value.schemaVersion === null || typeof value.schemaVersion === "string") &&
    isNonNegativeInteger(value.sizeBytes) &&
    (value.payloadBytes === null || isNonNegativeInteger(value.payloadBytes)) &&
    (value.payloadSha256 === null ||
      (typeof value.payloadSha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(value.payloadSha256))) &&
    (value.totalRecords === null || isNonNegativeInteger(value.totalRecords)) &&
    isRecordCounts(value.recordCounts) &&
    (value.status === "verified" || value.status === "invalid") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

export function isRecordCounts(value: unknown): value is Record<string, number> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([table, count]) => Boolean(table) && isNonNegativeInteger(count)
    )
  );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function backupCanRestore(backup: BackupRecord) {
  return (
    backup.status === "verified" &&
    !backup.error &&
    typeof backup.payloadSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(backup.payloadSha256)
  );
}

export function isPendingRestoreFor(
  value: RestoreStatus | null,
  backupId: string,
  expectedPayloadSha256: string
) {
  return (
    isPendingRestore(value) &&
    value.backupId === backupId &&
    value.expectedPayloadSha256 === expectedPayloadSha256
  );
}

export function isPendingRestore(
  value: RestoreStatus | null
): value is RestoreStatus & {
  version: 1;
  status: "pending_restart";
  backupId: string;
  fileName: string;
  expectedPayloadSha256: string;
  scheduledAt: string;
} {
  return (
    isObject(value) &&
    value.version === 1 &&
    value.status === "pending_restart" &&
    typeof value.backupId === "string" &&
    Boolean(value.backupId) &&
    typeof value.fileName === "string" &&
    Boolean(value.fileName) &&
    typeof value.expectedPayloadSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(value.expectedPayloadSha256) &&
    typeof value.scheduledAt === "string" &&
    Number.isFinite(Date.parse(value.scheduledAt)) &&
    (value.safetyBackupPath === undefined ||
      typeof value.safetyBackupPath === "string")
  );
}

export function errorMessage(value: unknown, fallback: string) {
  return isObject(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

export function messageFrom(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message : fallback;
}
