"use client";

import { ShieldCheck, X } from "lucide-react";
import { useDataManagement } from "./use-data-management";
import { ExportsPanel } from "./exports-panel";
import { BackupToolbar } from "./backup-toolbar";
import { BackupList } from "./backup-list";
import { BackupDetails } from "./backup-details";
import { AutomaticBackupPanel } from "./automatic-backup-policy";
import { RestoreConfirmation } from "./restore-flow";
import { RestoreStatusCard } from "./restore-status";

export function DataManagementDialog({
  onClose,
  onAnnounce
}: {
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const {
    backupIndex,
    selectedBackupId,
    setSelectedBackupId,
    selectedBackup,
    busy,
    exportBusy,
    error,
    setError,
    notice,
    restoreConfirmOpen,
    confirmation,
    setConfirmation,
    dialogRef,
    restoreDialogRef,
    restoreCancelRef,
    restoreTriggerRef,
    loadBackups,
    createBackup,
    saveAutomaticPolicy,
    downloadCsvExport,
    openRestoreConfirmation,
    dismissRestoreConfirmation,
    stageRestore,
    cancelPendingRestore,
    busyLabel
  } = useDataManagement({ onClose, onAnnounce });

  return (
    <div
      className="data-management-overlay"
      onMouseDown={(event) => {
        if (
          event.currentTarget === event.target &&
          (!busy || busy === "loading") &&
          !restoreConfirmOpen
        ) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="data-management-dialog"
        role="dialog"
        aria-modal="true"
        inert={restoreConfirmOpen || undefined}
        aria-labelledby="data-management-title"
        aria-describedby="data-management-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="data-management-heading">
          <div>
            <span className="eyebrow">Local data</span>
            <h2 id="data-management-title">Data &amp; backups</h2>
            <p id="data-management-description">
              Download portable history, create verified recovery copies, and
              schedule a conservative restore.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close data and backups"
            disabled={Boolean(busy && busy !== "loading")}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <ExportsPanel exportBusy={exportBusy} downloadCsvExport={downloadCsvExport} />

        <BackupToolbar
          backupIndex={backupIndex}
          busy={busy}
          loadBackups={loadBackups}
          createBackup={createBackup}
        />

        {backupIndex?.pendingRestore && (
          <RestoreStatusCard
            kind="pending"
            value={backupIndex.pendingRestore}
            backups={backupIndex.backups}
            busy={Boolean(busy)}
            onCancel={() => void cancelPendingRestore()}
          />
        )}

        {backupIndex?.lastRestore && (
          <RestoreStatusCard
            kind="last"
            value={backupIndex.lastRestore}
            backups={backupIndex.backups}
            busy={Boolean(busy)}
          />
        )}

        <div className="data-management-content">
          {backupIndex && (
            <AutomaticBackupPanel
              state={backupIndex.automatic}
              directory={backupIndex.directory}
              busy={busy === "scheduling"}
              disabled={Boolean(busy) && busy !== "scheduling"}
              onSave={saveAutomaticPolicy}
            />
          )}

          <BackupList
            backupIndex={backupIndex}
            busy={busy}
            selectedBackupId={selectedBackupId}
            setSelectedBackupId={setSelectedBackupId}
          />

          <section
            className="backup-detail-panel panel"
            aria-label="Backup details"
          >
            {selectedBackup ? (
              <BackupDetails
                backup={selectedBackup}
                pending={Boolean(backupIndex?.pendingRestore)}
                busy={Boolean(busy)}
                onRestore={openRestoreConfirmation}
                restoreTriggerRef={restoreTriggerRef}
              />
            ) : (
              <div className="data-management-empty">
                <ShieldCheck size={20} />
                <span>Select a backup to inspect its verified details.</span>
              </div>
            )}
          </section>
        </div>

        <div
          className="data-management-live"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {busyLabel || notice}
        </div>
        {error && !restoreConfirmOpen && (
          <div className="data-management-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
      </section>

      {restoreConfirmOpen && selectedBackup && (
        <RestoreConfirmation
          selectedBackup={selectedBackup}
          busy={busy}
          dismissRestoreConfirmation={dismissRestoreConfirmation}
          restoreDialogRef={restoreDialogRef}
          restoreCancelRef={restoreCancelRef}
          confirmation={confirmation}
          setConfirmation={setConfirmation}
          error={error}
          setError={setError}
          stageRestore={stageRestore}
        />
      )}
    </div>
  );
}
