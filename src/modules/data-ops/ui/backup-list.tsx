"use client";

import { HardDriveDownload, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { backupCanRestore } from "./backup-model";
import { formatDate, formatBytes, formatInteger } from "./backup-formatters";
import type { DataManagementState } from "./use-data-management";

export function BackupList({
  backupIndex,
  busy,
  selectedBackupId,
  setSelectedBackupId
}: Pick<DataManagementState,
  "backupIndex" | "busy" | "selectedBackupId" | "setSelectedBackupId"
>) {
  return (
    <section
      className="backup-list-panel"
      aria-label="Available backups"
    >
      {busy === "loading" && !backupIndex && (
        <div className="data-management-empty">
          <LoaderCircle className="spin" size={18} />
          <span>Checking local backups…</span>
        </div>
      )}
      {backupIndex && backupIndex.backups.length === 0 && (
        <div className="data-management-empty">
          <HardDriveDownload size={20} />
          <strong>No backups yet</strong>
          <span>Create the first complete recovery copy.</span>
        </div>
      )}
      {backupIndex?.backups.map((backup) => (
        <button
          key={backup.id}
          className={
            backup.id === selectedBackupId
              ? "backup-list-item selected"
              : "backup-list-item"
          }
          aria-pressed={backup.id === selectedBackupId}
          disabled={Boolean(busy)}
          onClick={() => setSelectedBackupId(backup.id)}
        >
          <span
            className={
              backupCanRestore(backup)
                ? "backup-status-icon verified"
                : "backup-status-icon invalid"
            }
            aria-hidden="true"
          >
            {backupCanRestore(backup) ? (
              <ShieldCheck size={16} />
            ) : (
              <X size={15} />
            )}
          </span>
          <span>
            <strong>{backup.fileName}</strong>
            <small>
              {formatDate(backup.createdAt)} ·{" "}
              {formatBytes(backup.payloadBytes)}
            </small>
          </span>
          <small className="backup-list-count">
            {formatInteger(backup.totalRecords)} records
          </small>
        </button>
      ))}
    </section>
  );
}
