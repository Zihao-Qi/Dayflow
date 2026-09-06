"use client";

import { ArchiveRestore, LoaderCircle } from "lucide-react";
import type { DataManagementState } from "./use-data-management";

export function RestoreConfirmation({
  selectedBackup,
  busy,
  dismissRestoreConfirmation,
  restoreDialogRef,
  restoreCancelRef,
  confirmation,
  setConfirmation,
  error,
  setError,
  stageRestore
}: Pick<DataManagementState,
  | "selectedBackup"
  | "busy"
  | "dismissRestoreConfirmation"
  | "restoreDialogRef"
  | "restoreCancelRef"
  | "confirmation"
  | "setConfirmation"
  | "error"
  | "setError"
  | "stageRestore"
> & { selectedBackup: NonNullable<DataManagementState["selectedBackup"]> }) {
  return (
    <div
      className="data-restore-confirm-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) {
          dismissRestoreConfirmation();
        }
      }}
    >
      <section
        ref={restoreDialogRef}
        className="data-restore-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="data-restore-title"
        aria-describedby="data-restore-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">Replace all current data</span>
        <h2 id="data-restore-title">Restore this backup on next startup?</h2>
        <div id="data-restore-description">
          <p>
            Dayflow will keep using the current data until its next
            startup. Before replacement, it will create a separate safety
            backup of the current database.
          </p>
          <p className="data-restore-file">{selectedBackup.fileName}</p>
        </div>
        <label>
          Type <strong>RESTORE</strong> to schedule replacement
          <input
            value={confirmation}
            disabled={Boolean(busy)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && (
          <div className="data-management-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {busy === "staging" ? "Scheduling restore…" : ""}
        </span>
        <div className="data-restore-actions">
          <button
            ref={restoreCancelRef}
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={dismissRestoreConfirmation}
          >
            Cancel
          </button>
          <button
            className="primary-button data-restore-button"
            disabled={confirmation !== "RESTORE" || Boolean(busy)}
            onClick={() => void stageRestore()}
          >
            {busy === "staging" ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <ArchiveRestore size={14} />
            )}
            {busy === "staging"
              ? "Scheduling…"
              : "Restore on next startup"}
          </button>
        </div>
      </section>
    </div>
  );
}
