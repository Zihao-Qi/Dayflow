"use client";

import { HardDriveDownload, LoaderCircle, RefreshCw } from "lucide-react";
import type { DataManagementState } from "./use-data-management";

export function BackupToolbar({
  backupIndex,
  busy,
  loadBackups,
  createBackup
}: Pick<DataManagementState,
  "backupIndex" | "busy" | "loadBackups" | "createBackup"
>) {
  return (
    <div className="data-management-toolbar">
      <div>
        <strong>Verified local backups</strong>
        <small className="data-path">
          {backupIndex?.directory ?? "Loading backup directory…"}
        </small>
      </div>
      <div>
        <button
          className="secondary-button"
          disabled={Boolean(busy)}
          onClick={() => void loadBackups()}
        >
          <RefreshCw
            className={busy === "loading" ? "spin" : ""}
            size={14}
          />
          Refresh
        </button>
        <button
          className="primary-button"
          disabled={Boolean(busy)}
          onClick={() => void createBackup()}
        >
          {busy === "creating" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <HardDriveDownload size={14} />
          )}
          {busy === "creating" ? "Creating…" : "Create backup"}
        </button>
      </div>
    </div>
  );
}
