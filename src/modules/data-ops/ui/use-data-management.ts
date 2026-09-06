"use client";

import {
  cancelRestore as cancelRestoreRequest,
  createBackup as createBackupRequest,
  downloadCsv as downloadCsvRequest,
  loadBackups as loadBackupsRequest,
  saveAutomaticPolicy as saveAutomaticPolicyRequest,
  stageRestore as stageRestoreRequest
} from "@/modules/data-ops/ui/api";
import { type AutomaticBackupPolicy } from "@/lib/automatic-backup-contract";
import { type CsvExportKind } from "@/lib/csv-export-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backupCanRestore, messageFrom, type BackupIndex, type BusyAction } from "./backup-model";

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

// Called only by the dialog shell: confirmation, downloads and focus refs
// remain alive together until that dialog unmounts.
export function useDataManagement({
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
      const result = await loadBackupsRequest();

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
      const result = await createBackupRequest();

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
      const result = await saveAutomaticPolicyRequest(policy);

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
      const { blob, metadata } = await downloadCsvRequest(kind);
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
      const result = await stageRestoreRequest(selectedBackup.id, expectedPayloadSha256);

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
      const result = await cancelRestoreRequest();

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

  return {
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
  };
}

export type DataManagementState = ReturnType<typeof useDataManagement>;

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

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
      element.isConnected &&
      element.getClientRects().length > 0 &&
      !element.hasAttribute("disabled") &&
      !element.closest("[inert]")
  );
}
