"use client";

import { ArchiveRestore, CheckCircle2, Trash2, X } from "lucide-react";
import { isPendingRestore, type BackupRecord, type RestoreStatus } from "./backup-model";
import { formatDate, stringField, humanizeStatus } from "./backup-formatters";

export function RestoreStatusCard({
  kind,
  value,
  backups,
  busy,
  onCancel
}: {
  kind: "pending" | "last";
  value: RestoreStatus;
  backups: BackupRecord[];
  busy: boolean;
  onCancel?: () => void;
}) {
  const backupId = stringField(value, "backupId");
  const listedBackup = backups.find((backup) => backup.id === backupId);
  const fileName =
    stringField(value, "fileName") ?? listedBackup?.fileName ?? backupId;
  const status = stringField(value, "status");
  const error = stringField(value, "error");
  const needsAttention = kind === "pending" && !isPendingRestore(value);
  const safetyBackupPath = stringField(value, "safetyBackupPath");
  const moment =
    stringField(value, "scheduledAt") ??
    stringField(value, "requestedAt") ??
    stringField(value, "completedAt") ??
    stringField(value, "appliedAt") ??
    stringField(value, "createdAt");

  return (
    <section
      className={
        needsAttention
          ? "restore-status-card failed"
          : kind === "pending"
          ? "restore-status-card pending"
          : error
            ? "restore-status-card failed"
            : "restore-status-card complete"
      }
      aria-label={
        needsAttention
          ? "Pending restore needs attention"
          : kind === "pending"
            ? "Pending restore"
            : "Last restore"
      }
    >
      <span aria-hidden="true">
        {needsAttention || error ? (
          <X size={17} />
        ) : kind === "pending" ? (
          <ArchiveRestore size={17} />
        ) : (
          <CheckCircle2 size={17} />
        )}
      </span>
      <div>
        <strong>
          {needsAttention
            ? "Pending restore needs attention"
            : kind === "pending"
            ? "Restore scheduled for next startup"
            : status
              ? `Last restore: ${humanizeStatus(status)}`
              : "Last restore completed"}
        </strong>
        <small>
          {[fileName, moment ? formatDate(moment) : null]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {kind === "pending" && !needsAttention && (
          <small>
            Current data remains active. A safety backup will be created before
            replacement.
          </small>
        )}
        {error && <small className="restore-status-error">{error}</small>}
        {safetyBackupPath && (
          <small className="data-path">
            Safety backup: {safetyBackupPath}
          </small>
        )}
      </div>
      {onCancel && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
        >
          <Trash2 size={13} />
          Cancel pending restore
        </button>
      )}
    </section>
  );
}
