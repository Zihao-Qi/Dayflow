"use client";

import { ArchiveRestore, CheckCircle2, Download, X } from "lucide-react";
import { backupCanRestore, type BackupRecord } from "./backup-model";
import { formatDate, formatBytes, formatInteger, splitIdentifier } from "./backup-formatters";

export function BackupDetails({
  backup,
  pending,
  busy,
  onRestore,
  restoreTriggerRef
}: {
  backup: BackupRecord;
  pending: boolean;
  busy: boolean;
  onRestore: () => void;
  restoreTriggerRef: { current: HTMLButtonElement | null };
}) {
  return (
    <>
      <div className="backup-detail-heading">
        <div>
          <span
            className={
              backupCanRestore(backup)
                ? "backup-verification verified"
                : "backup-verification invalid"
            }
          >
            {backupCanRestore(backup) ? (
              <CheckCircle2 size={14} />
            ) : (
              <X size={14} />
            )}
            {backupCanRestore(backup) ? "Verified" : "Unavailable"}
          </span>
          <h3>{backup.fileName}</h3>
        </div>
        {backupCanRestore(backup) && (
          <a
            className="secondary-button"
            href={`/api/backups/${encodeURIComponent(backup.id)}/download`}
            download={backup.fileName}
          >
            <Download size={14} />
            Download
          </a>
        )}
      </div>

      {backup.error && <p className="form-error">{backup.error}</p>}

      <dl className="backup-facts">
        <div>
          <dt>Created</dt>
          <dd>{formatDate(backup.createdAt)}</dd>
        </div>
        <div>
          <dt>Dayflow</dt>
          <dd>{backup.applicationVersion ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd className="data-path">{backup.schemaVersion ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Payload</dt>
          <dd>
            {formatBytes(backup.payloadBytes)}
            {backup.payloadBytes !== null &&
            backup.sizeBytes !== backup.payloadBytes
              ? ` · ${formatBytes(backup.sizeBytes)} archive`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Records</dt>
          <dd>{formatInteger(backup.totalRecords)}</dd>
        </div>
      </dl>

      <div className="backup-record-counts">
        <strong>Records by table</strong>
        <dl>
          {Object.entries(backup.recordCounts)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([table, count]) => (
              <div key={table}>
                <dt>{splitIdentifier(table)}</dt>
                <dd>{formatInteger(count)}</dd>
              </div>
            ))}
        </dl>
      </div>

      <div className="backup-technical-details">
        <span>
          <strong>Checksum</strong>
          <code>{backup.payloadSha256 ?? "Unavailable"}</code>
        </span>
        <span>
          <strong>Local path</strong>
          <code>{backup.path}</code>
        </span>
      </div>

      <div className="backup-detail-actions">
        <p>
          Restore is staged safely and applies only when Dayflow starts again.
        </p>
        <button
          ref={restoreTriggerRef}
          className="secondary-button data-restore-open"
          disabled={
            busy || pending || !backupCanRestore(backup)
          }
          onClick={onRestore}
        >
          <ArchiveRestore size={14} />
          {pending ? "Restore already pending" : "Restore this backup…"}
        </button>
      </div>
    </>
  );
}
