"use client";

import {
  ArchiveRestore,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  parseCsvExportResponseMetadata,
  type CsvExportKind
} from "@/lib/csv-export-contract";

type BackupRecord = {
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

type RestoreStatus = Record<string, unknown>;

type BackupIndex = {
  directory: string;
  automatic: AutomaticBackupState;
  backups: BackupRecord[];
  pendingRestore: RestoreStatus | null;
  lastRestore: RestoreStatus | null;
};

type AutomaticBackupPolicy = {
  enabled: boolean;
  intervalHours: number;
  retainCount: number;
};

type AutomaticBackupState = {
  policy: AutomaticBackupPolicy;
  schedule: { due: boolean; nextDueAt: string | null };
  retention: {
    automaticCount: number;
    retainCount: number;
    beyondRetention: number;
  };
  lastSuccessAt: string | null;
  lastAttempt: {
    status: "succeeded" | "failed" | "skipped";
    at: string;
    fileName?: string;
    reason?: string;
  } | null;
};

type BusyAction =
  | "loading"
  | "creating"
  | "staging"
  | "canceling"
  | "scheduling";

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const mutationHeaders = {
  "Content-Type": "application/json",
  "X-Dayflow-Local-Action": "1"
} as const;

export function DataManagementDialog({
  onClose,
  onAnnounce
}: {
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const [backupIndex, setBackupIndex] = useState<BackupIndex | null>(null);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [exportBusy, setExportBusy] =
    useState<CsvExportKind[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const restoreDialogRef = useRef<HTMLElement>(null);
  const restoreCancelRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef<BusyAction | null>(null);
  const restoreOpenRef = useRef(false);
  const closeRef = useRef(onClose);

  const selectedBackup = useMemo(
    () =>
      backupIndex?.backups.find((backup) => backup.id === selectedBackupId) ??
      null,
    [backupIndex, selectedBackupId]
  );

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    restoreOpenRef.current = restoreConfirmOpen;
  }, [restoreConfirmOpen]);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const loadBackups = useCallback(async (showLoading = true) => {
    if (showLoading) setBusy("loading");
    setError("");
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      const result = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(result, "Backups could not be loaded."));
      }
      if (!isBackupIndex(result)) {
        throw new Error("Dayflow returned an invalid backup list.");
      }
      setBackupIndex(result);
      setSelectedBackupId((current) =>
        result.backups.some((backup) => backup.id === current)
          ? current
          : result.backups[0]?.id ?? ""
      );
      return true;
    } catch (loadError) {
      setError(messageFrom(loadError, "Backups could not be loaded."));
      return false;
    } finally {
      if (showLoading) setBusy(null);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(focusableSelector)
        ?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busyRef.current && busyRef.current !== "loading") return;
        event.preventDefault();
        if (restoreOpenRef.current) {
          dismissRestoreConfirmation();
        } else {
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const container = restoreOpenRef.current
        ? restoreDialogRef.current
        : dialogRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(
        focusableSelector
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (canReceiveFocus(opener)) {
          opener.focus();
          return;
        }
        const fallbackSelector =
          document.documentElement.dataset.layoutMode === "phone"
            ? ".nav-item.mobile-more"
            : ".sidebar-data-button";
        [...document.querySelectorAll<HTMLElement>(fallbackSelector)]
          .find(canReceiveFocus)
          ?.focus();
      });
    };
  }, []);

  useEffect(() => {
    if (restoreConfirmOpen) {
      window.requestAnimationFrame(() => restoreCancelRef.current?.focus());
    }
  }, [restoreConfirmOpen]);

  function dismissRestoreConfirmation() {
    setRestoreConfirmOpen(false);
    setConfirmation("");
    window.requestAnimationFrame(() => {
      if (canReceiveFocus(restoreTriggerRef.current)) {
        restoreTriggerRef.current.focus();
      } else {
        dialogRef.current?.focus();
      }
    });
  }

  async function createBackup() {
    if (busy) return;
    setBusy("creating");
    setError("");
    setNotice("Creating and verifying a complete backup…");
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: mutationHeaders,
        body: "{}"
      });
      const result = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(result, "The backup could not be created."));
      }
      if (!isBackupCreateResponse(result) || !backupCanRestore(result.backup)) {
        throw new Error(
          "Dayflow returned an invalid backup result. Refresh before relying on this backup."
        );
      }
      const createdBackup = result.backup;
      setBackupIndex((current) =>
        current
          ? {
              ...current,
              backups: [
                createdBackup,
                ...current.backups.filter(
                  (backup) => backup.id !== createdBackup.id
                )
              ]
            }
          : current
      );
      setSelectedBackupId(createdBackup.id);
      setNotice("Backup created and verified.");
      onAnnounce("Backup created and verified.");

      const refreshed = await loadBackups(false);
      if (!refreshed) {
        setNotice(
          "The backup was created, but Dayflow could not refresh the backup list."
        );
      } else {
        setSelectedBackupId(createdBackup.id);
      }
    } catch (createError) {
      setError(messageFrom(createError, "The backup could not be created."));
      setNotice("");
    } finally {
      setBusy(null);
    }
  }

  async function saveAutomaticPolicy(policy: AutomaticBackupPolicy) {
    let saved = false;
    setBusy("scheduling");
    setError("");
    try {
      const response = await fetch("/api/backups/automatic", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Local-Action": "1"
        },
        body: JSON.stringify(policy)
      });
      const result = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(result, "Automatic backups could not be updated.")
        );
      }
      if (!isAutomaticBackupState(result)) {
        throw new Error("Dayflow returned invalid automatic backup settings.");
      }
      setBackupIndex((current) =>
        current ? { ...current, automatic: result } : current
      );
      saved = true;
    } catch (policyError) {
      setError(
        messageFrom(policyError, "Automatic backups could not be updated.")
      );
    } finally {
      setBusy(null);
    }
    return saved;
  }

  async function downloadCsvExport(kind: CsvExportKind) {
    if (exportBusy.includes(kind)) return;
    const label = kind === "tasks" ? "Task" : "Activity";
    setExportBusy((current) => [...new Set([...current, kind])]);
    setError("");
    setNotice(`Preparing complete ${label} history…`);
    try {
      const response = await fetch(`/api/exports/${kind}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        const result = await readJson(response);
        throw new Error(
          errorMessage(
            result,
            `${label} CSV could not be downloaded.`
          )
        );
      }

      const metadata = parseCsvExportResponseMetadata(
        kind,
        response.headers
      );
      if (!metadata) {
        throw new Error(
          `Dayflow returned an invalid ${label} CSV. Try again.`
        );
      }

      const blob = await response.blob();
      triggerDownload(blob, metadata.fileName);
      setNotice(
        `${label} CSV downloaded with ${metadata.recordCount.toLocaleString()} records.`
      );
      onAnnounce(`${label} CSV downloaded.`);
    } catch (exportError) {
      setError(
        messageFrom(
          exportError,
          `${label} CSV could not be downloaded.`
        )
      );
      setNotice("");
    } finally {
      setExportBusy((current) =>
        current.filter((candidate) => candidate !== kind)
      );
    }
  }

  function openRestoreConfirmation() {
    if (!selectedBackup || !backupCanRestore(selectedBackup) || busy) return;
    setConfirmation("");
    setError("");
    setRestoreConfirmOpen(true);
  }

  async function stageRestore() {
    const expectedPayloadSha256 = selectedBackup?.payloadSha256;
    if (
      !selectedBackup ||
      !expectedPayloadSha256 ||
      confirmation !== "RESTORE" ||
      busy ||
      !backupCanRestore(selectedBackup)
    ) {
      return;
    }
    setBusy("staging");
    setError("");
    setNotice("Scheduling the verified backup for the next startup…");
    try {
      const response = await fetch("/api/backups/restore", {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          backupId: selectedBackup.id,
          expectedPayloadSha256,
          confirmation: "RESTORE"
        })
      });
      const result = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(result, "The restore could not be scheduled.")
        );
      }
      if (
        !isBackupIndex(result) ||
        !isPendingRestoreFor(
          result.pendingRestore,
          selectedBackup.id,
          expectedPayloadSha256
        )
      ) {
        throw new Error(
          "Dayflow returned an invalid restore result. Refresh before trying again."
        );
      }
      setBackupIndex(result);
      setRestoreConfirmOpen(false);
      setConfirmation("");
      window.requestAnimationFrame(() => dialogRef.current?.focus());
      setNotice(
        "Restore scheduled. It will replace the data on the next Dayflow startup after creating a safety backup."
      );
      onAnnounce("Restore scheduled for the next Dayflow startup.");
      const refreshed = await loadBackups(false);
      if (!refreshed) {
        setNotice(
          "Restore was scheduled, but Dayflow could not refresh its status."
        );
      }
    } catch (restoreError) {
      setError(messageFrom(restoreError, "The restore could not be scheduled."));
      setNotice("");
    } finally {
      setBusy(null);
    }
  }

  async function cancelPendingRestore() {
    if (busy || !backupIndex?.pendingRestore) return;
    setBusy("canceling");
    setError("");
    setNotice("Canceling the pending restore…");
    try {
      const response = await fetch("/api/backups/restore", {
        method: "DELETE",
        headers: mutationHeaders,
        body: "{}"
      });
      const result = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(result, "The pending restore could not be canceled.")
        );
      }
      if (!isBackupIndex(result) || result.pendingRestore !== null) {
        throw new Error(
          "Dayflow returned an invalid cancellation result. Refresh before relying on this status."
        );
      }
      setBackupIndex(result);
      setNotice("Pending restore canceled. The current data will stay active.");
      onAnnounce("Pending restore canceled.");
      const refreshed = await loadBackups(false);
      if (!refreshed) {
        setNotice(
          "The pending restore was canceled, but Dayflow could not refresh its status."
        );
      }
    } catch (cancelError) {
      setError(
        messageFrom(cancelError, "The pending restore could not be canceled.")
      );
      setNotice("");
    } finally {
      setBusy(null);
    }
  }

  const busyLabel =
    busy === "loading"
      ? "Loading backups…"
      : busy === "creating"
        ? "Creating backup…"
        : busy === "staging"
          ? "Scheduling restore…"
          : busy === "canceling"
            ? "Canceling restore…"
            : "";

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
      )}
    </div>
  );
}

function AutomaticBackupPanel({
  state,
  directory,
  busy,
  disabled,
  onSave
}: {
  state: AutomaticBackupState;
  directory: string;
  busy: boolean;
  disabled: boolean;
  onSave: (policy: AutomaticBackupPolicy) => Promise<boolean>;
}) {
  const { policy, schedule, retention, lastAttempt } = state;
  // The control reflects the change immediately and reverts only if the
  // server rejects it, so the toggle never feels stuck waiting on a request.
  const [draft, setDraft] = useState(policy);
  useEffect(() => {
    setDraft(policy);
  }, [policy]);

  const save = (patch: Partial<AutomaticBackupPolicy>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void onSave(next).then((saved) => {
      if (!saved) setDraft(policy);
    });
  };

  return (
    <section
      className="automatic-backup-panel panel"
      aria-labelledby="automatic-backup-title"
    >
      <div className="automatic-backup-heading">
        <div>
          <span className="eyebrow">Unattended protection</span>
          <strong id="automatic-backup-title">Automatic backups</strong>
        </div>
        <label className="automatic-backup-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={disabled}
            onChange={(event) => save({ enabled: event.target.checked })}
          />
          <span>{draft.enabled ? "On" : "Off"}</span>
        </label>
      </div>

      <p className="automatic-backup-copy">
        Dayflow creates a verified backup on its own schedule while it is
        running. It never deletes a backup — removing old copies stays your
        choice.
      </p>

      <div className="automatic-backup-fields">
        <label htmlFor="automatic-backup-interval">
          <span>Every</span>
          <select
            id="automatic-backup-interval"
            value={draft.intervalHours}
            disabled={disabled || !draft.enabled}
            onChange={(event) =>
              save({ intervalHours: Number(event.target.value) })
            }
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>day</option>
            <option value={72}>3 days</option>
            <option value={168}>week</option>
          </select>
        </label>
        <label htmlFor="automatic-backup-retain">
          <span>Keep</span>
          <input
            id="automatic-backup-retain"
            type="number"
            min={1}
            max={50}
            step={1}
            value={draft.retainCount}
            disabled={disabled || !draft.enabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= 50) {
                save({ retainCount: next });
              }
            }}
          />
        </label>
      </div>

      <dl className="automatic-backup-facts">
        <div>
          <dt>Last automatic backup</dt>
          <dd>
            {state.lastSuccessAt ? formatDate(state.lastSuccessAt) : "None yet"}
          </dd>
        </div>
        <div>
          <dt>Next due</dt>
          <dd>
            {!draft.enabled
              ? "Not scheduled"
              : schedule.due
                ? "As soon as Dayflow checks"
                : formatDate(schedule.nextDueAt)}
          </dd>
        </div>
        <div>
          <dt>Automatic copies kept</dt>
          <dd>{retention.automaticCount}</dd>
        </div>
      </dl>

      {lastAttempt?.status === "failed" && (
        <p className="automatic-backup-failure" role="status">
          The last automatic backup did not complete
          {lastAttempt.reason ? `: ${lastAttempt.reason}` : "."} Dayflow will
          try again at the next check.
        </p>
      )}

      {retention.beyondRetention > 0 && (
        <p className="automatic-backup-retention" role="status">
          <strong>
            {retention.beyondRetention} automatic{" "}
            {retention.beyondRetention === 1 ? "copy is" : "copies are"} beyond
            the {retention.retainCount} you asked to keep.
          </strong>{" "}
          Dayflow has not deleted anything. Remove copies yourself in{" "}
          <code>{directory}</code> when you want the space back.
        </p>
      )}

      {busy && (
        <p className="automatic-backup-copy" role="status">
          Saving automatic backup settings…
        </p>
      )}
    </section>
  );
}

function BackupDetails({
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

function RestoreStatusCard({
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

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isBackupCreateResponse(
  value: unknown
): value is { backup: BackupRecord } {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    isBackupRecord(value.backup)
  );
}

function isBackupIndex(value: unknown): value is BackupIndex {
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

function isAutomaticBackupState(
  value: unknown
): value is AutomaticBackupState {
  if (!isObject(value)) return false;
  const policy = value.policy;
  const schedule = value.schedule;
  const retention = value.retention;
  return (
    isObject(policy) &&
    typeof policy.enabled === "boolean" &&
    isNonNegativeInteger(policy.intervalHours) &&
    isNonNegativeInteger(policy.retainCount) &&
    isObject(schedule) &&
    typeof schedule.due === "boolean" &&
    (schedule.nextDueAt === null || typeof schedule.nextDueAt === "string") &&
    isObject(retention) &&
    isNonNegativeInteger(retention.automaticCount) &&
    isNonNegativeInteger(retention.retainCount) &&
    isNonNegativeInteger(retention.beyondRetention) &&
    (value.lastSuccessAt === null ||
      typeof value.lastSuccessAt === "string") &&
    (value.lastAttempt === null || isObject(value.lastAttempt))
  );
}

function isBackupRecord(value: unknown): value is BackupRecord {
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

function isRecordCounts(value: unknown): value is Record<string, number> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([table, count]) => Boolean(table) && isNonNegativeInteger(count)
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function backupCanRestore(backup: BackupRecord) {
  return (
    backup.status === "verified" &&
    !backup.error &&
    typeof backup.payloadSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(backup.payloadSha256)
  );
}

function isPendingRestoreFor(
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

function isPendingRestore(
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

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
      element.isConnected &&
      element.getClientRects().length > 0 &&
      !element.hasAttribute("disabled") &&
      !element.closest("[inert]")
  );
}

function errorMessage(value: unknown, fallback: string) {
  return isObject(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

function messageFrom(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message : fallback;
}

function stringField(value: RestoreStatus, field: string) {
  return typeof value[field] === "string" ? String(value[field]) : null;
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatBytes(value: number | null) {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function formatInteger(value: number | null) {
  if (value === null) return "Unavailable";
  return new Intl.NumberFormat().format(value);
}

function splitIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
}

function humanizeStatus(value: string) {
  return splitIdentifier(value.toLowerCase()).replace(/^\w/, (letter) =>
    letter.toUpperCase()
  );
}
