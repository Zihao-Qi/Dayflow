"use client";

import { Download, FileSpreadsheet, LoaderCircle } from "lucide-react";
import type { DataManagementState } from "./use-data-management";

export function ExportsPanel({
  exportBusy,
  downloadCsvExport
}: Pick<DataManagementState,
  "exportBusy" | "downloadCsvExport"
>) {
  return (
    <section
      className="data-export-panel"
      aria-labelledby="data-export-title"
    >
      <div className="data-export-copy">
        <span className="data-export-icon" aria-hidden="true">
          <FileSpreadsheet size={18} />
        </span>
        <div>
          <strong id="data-export-title">Portable CSV exports</strong>
          <small>
            Complete history for spreadsheets and analysis. CSV is not a
            recovery backup.
          </small>
        </div>
      </div>
      <div className="data-export-actions">
        <button
          className="secondary-button"
          disabled={exportBusy.includes("tasks")}
          onClick={() => void downloadCsvExport("tasks")}
        >
          {exportBusy.includes("tasks") ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Download size={14} />
          )}
          {exportBusy.includes("tasks")
            ? "Preparing Tasks…"
            : "Download Tasks CSV"}
        </button>
        <button
          className="secondary-button"
          disabled={exportBusy.includes("activities")}
          onClick={() => void downloadCsvExport("activities")}
        >
          {exportBusy.includes("activities") ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Download size={14} />
          )}
          {exportBusy.includes("activities")
            ? "Preparing Activities…"
            : "Download Activities CSV"}
        </button>
      </div>
    </section>
  );
}
