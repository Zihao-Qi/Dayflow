import { systemClock, type Clock } from "@/shared/kernel/calendar";
import { backupErrors } from "@/lib/backup-errors";
import { AppError } from "@/shared/kernel/errors";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultBackupPath, restoreDatabaseBackup } from "./sqlite-backup-engine";
import {
  METADATA_VERSION,
  type BackupContext,
  type BackupManagementOptions,
  withOperation,
  resolveBackupContext,
  pathEntryExists,
  resolveVerifiedBackup,
  writeJsonAtomically,
  syncDirectory,
  resolveManagedBackupPath,
  openVerifiedManagedBackup,
  withAsyncOperation,
  readManagedJson,
  isObject,
  isValidBackupId,
  BACKUP_FILE_PATTERN,
  errorCode,
  MAX_PERSISTED_ERROR_LENGTH,
  readMetadataForDisplay
} from "./managed-backup-storage";

const PENDING_FILE = ".dayflow-restore-pending.json";

const APPLYING_FILE = ".dayflow-restore-applying.json";

const STATUS_FILE = ".dayflow-restore-status.json";

const OWNER_FILE = ".dayflow-restore-owner.json";

const RESTORE_OWNER_POLL_MS = 100;

const RESTORE_OWNER_WAIT_MS = 10 * 60 * 1000;

const RESTORE_OWNER_STALE_MS = 6 * 60 * 60 * 1000;

export type PendingRestore = {
  version: typeof METADATA_VERSION;
  status: "pending_restart";
  backupId: string;
  fileName: string;
  expectedPayloadSha256: string;
  scheduledAt: string;
  safetyBackupPath?: string;
};

export type RestoreStatus = {
  version: typeof METADATA_VERSION;
  status: "succeeded" | "failed";
  backupId: string;
  fileName: string;
  requestedAt: string;
  completedAt: string;
  safetyBackupPath: string | null;
  schemaVersion?: string;
  recordCounts?: Record<string, number>;
  error?: string;
};

type RestoreOwner = {
  version: typeof METADATA_VERSION;
  token: string;
  pid: number;
  startedAt: string;
};

export function restoreIsInFlight(context: BackupContext) {
  if (!context.directoryExists) return false;
  return (
    existsSync(join(context.directory, PENDING_FILE)) ||
    existsSync(join(context.directory, APPLYING_FILE))
  );
}

export function stageManagedRestore(
  input: {
    backupId: string;
    expectedPayloadSha256: string;
    confirmation: string;
  },
  options: BackupManagementOptions = {}
): PendingRestore {
  return withOperation(() => {
    if (input.confirmation !== "RESTORE") {
      throw new AppError(backupErrors.typeRESTOREExactlyToScheduleReplacement);
    }
    if (!/^[a-f0-9]{64}$/.test(input.expectedPayloadSha256)) {
      throw new AppError(backupErrors.theSelectedBackupChecksumIsInvalid);
    }

    const context = resolveBackupContext(options, "mutation");
    assertRestoreEnabled(context.environment);
    const pendingPath = join(context.directory, PENDING_FILE);
    const applyingPath = join(context.directory, APPLYING_FILE);
    if (pathEntryExists(pendingPath) || pathEntryExists(applyingPath)) {
      throw new AppError(backupErrors.anotherRestoreIsAlreadyPending);
    }

    const backup = resolveVerifiedBackup(input.backupId, context);
    if (backup.payloadSha256 !== input.expectedPayloadSha256) {
      throw new AppError(backupErrors.theSelectedBackupChangedAfterItWasInspectedRefreshAndTry);
    }

    const pending: PendingRestore = {
      version: METADATA_VERSION,
      status: "pending_restart",
      backupId: backup.id,
      fileName: backup.fileName,
      expectedPayloadSha256: input.expectedPayloadSha256,
      scheduledAt: (options.now ?? (options.clock ?? systemClock).now()).toISOString()
    };
    writeJsonAtomically(pendingPath, pending);
    return pending;
  });
}

export function cancelManagedRestore(
  options: BackupManagementOptions = {}
) {
  return withOperation(() => {
    const context = resolveBackupContext(options, "mutation");
    const pendingPath = join(context.directory, PENDING_FILE);
    if (!pathEntryExists(pendingPath)) {
      throw new AppError(backupErrors.noRestoreIsCurrentlyPending);
    }
    rmSync(pendingPath);
    syncDirectory(context.directory);
  });
}

export function resolveManagedBackupDownload(
  backupId: string,
  options: BackupManagementOptions = {}
) {
  const context = resolveBackupContext(options, "read");
  const backupPath = resolveManagedBackupPath(backupId, context);
  const opened = openVerifiedManagedBackup(backupPath);
  return {
    path: opened.summary.path,
    fileName: opened.summary.fileName,
    sizeBytes: opened.summary.sizeBytes,
    fileDescriptor: opened.fileDescriptor
  };
}

export async function applyPendingManagedRestore(
  options: BackupManagementOptions = {}
): Promise<RestoreStatus | null> {
  const clock = options.clock ?? systemClock;
  const context = resolveBackupContext(options, "read");
  if (context.environment.DAYFLOW_DISABLE_RESTORE === "1") return null;
  if (!context.directoryExists) return null;

  return withAsyncOperation(async () => {
    const pendingPath = join(context.directory, PENDING_FILE);
    const applyingPath = join(context.directory, APPLYING_FILE);
    const statusPath = join(context.directory, STATUS_FILE);
    if (!pathEntryExists(pendingPath) && !pathEntryExists(applyingPath)) {
      return null;
    }

    const owner = await acquireRestoreOwnership(context.directory, clock);
    try {
      if (pathEntryExists(applyingPath)) {
        let interrupted: PendingRestore;
        try {
          interrupted = readPendingRestore(applyingPath);
        } catch (error) {
          console.error(
            "[Dayflow restore] Interrupted restore metadata was invalid.",
            error
          );
          interrupted = fallbackPendingRestore(clock.now());
        }

        const completed = readRestoreStatus(statusPath);
        if (
          completed?.status === "succeeded" &&
          restoreStatusMatches(completed, interrupted)
        ) {
          clearRestoreMarkers(context.directory);
          return completed;
        }

        const verifiedSafetyPath = verifiedSafetyBackupPath(
          interrupted.safetyBackupPath,
          context.directory
        );
        const status = failedRestoreStatus(
          interrupted,
          verifiedSafetyPath
            ? "A previous restore stopped before completion could be confirmed. Verify the active data before choosing whether to recover from the verified safety backup."
            : "A previous restore stopped before completion could be confirmed. Verify the active data before scheduling another restore.",
          verifiedSafetyPath,
          clock.now()
        );
        writeJsonAtomically(statusPath, status);
        clearRestoreMarkers(context.directory);
        console.error(`[Dayflow restore] ${status.error}`);
        return status;
      }
      if (!pathEntryExists(pendingPath)) return null;

      renameSync(pendingPath, applyingPath);
      syncDirectory(context.directory);

      let pending: PendingRestore;
      try {
        pending = readPendingRestore(applyingPath);
      } catch (error) {
        console.error(
          "[Dayflow restore] Scheduled restore metadata was invalid.",
          error
        );
        const fallback = fallbackPendingRestore(clock.now());
        const status = failedRestoreStatus(
          fallback,
          "The scheduled restore metadata was invalid and was discarded. The active database was not intentionally replaced.",
          null,
          clock.now()
        );
        writeJsonAtomically(statusPath, status);
        clearRestoreMarkers(context.directory);
        return status;
      }

      const restoreAt = options.now ?? clock.now();
      const safetyBackupPath = join(
        context.directory,
        basename(
          defaultBackupPath(
            context.databasePath,
            "restore-safety",
            restoreAt
          )
        )
      );
      pending = { ...pending, safetyBackupPath };
      writeJsonAtomically(applyingPath, pending);

      try {
        const backup = resolveVerifiedBackup(pending.backupId, context);
        if (
          backup.fileName !== pending.fileName ||
          backup.payloadSha256 !== pending.expectedPayloadSha256
        ) {
          throw new AppError(backupErrors.theScheduledBackupChangedBeforeStartupAndWasNotRestored);
        }

        const result = await restoreDatabaseBackup({
          databasePath: context.databasePath,
          backupPath: backup.path,
          safetyBackupPath,
          expectedPayloadSha256: pending.expectedPayloadSha256,
          repositoryRoot: context.repositoryRoot,
          now: restoreAt,
          onProgress: (message) =>
            console.log(`[Dayflow restore] ${message}`)
        });
        const status: RestoreStatus = {
          version: METADATA_VERSION,
          status: "succeeded",
          backupId: pending.backupId,
          fileName: pending.fileName,
          requestedAt: pending.scheduledAt,
          completedAt: clock.now().toISOString(),
          safetyBackupPath: result.safetyBackupPath,
          schemaVersion: result.schemaVersion,
          recordCounts: result.restoredRecordCounts
        };
        writeJsonAtomically(statusPath, status);
        clearRestoreMarkers(context.directory);
        console.log(
          `[Dayflow restore] Restored ${pending.fileName}. Safety backup: ${result.safetyBackupPath ?? "not needed"}.`
        );
        return status;
      } catch (error) {
        console.error("[Dayflow restore] Raw restore diagnostic:", error);
        const safetyPath = verifiedSafetyBackupPath(
          pending.safetyBackupPath,
          context.directory
        );
        const status = failedRestoreStatus(
          pending,
          persistedRestoreError(error, Boolean(safetyPath)),
          safetyPath,
          clock.now()
        );
        writeJsonAtomically(statusPath, status);
        clearRestoreMarkers(context.directory);
        console.error(`[Dayflow restore] ${status.error}`);
        return status;
      }
    } finally {
      releaseRestoreOwnership(context.directory, owner);
    }
  });
}

function readPendingRestore(path: string): PendingRestore {
  const value = readManagedJson(path);
  if (
    !isObject(value) ||
    value.version !== METADATA_VERSION ||
    value.status !== "pending_restart" ||
    !isValidBackupId(value.backupId) ||
    typeof value.fileName !== "string" ||
    !BACKUP_FILE_PATTERN.test(value.fileName) ||
    typeof value.expectedPayloadSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.expectedPayloadSha256) ||
    typeof value.scheduledAt !== "string" ||
    !Number.isFinite(Date.parse(value.scheduledAt)) ||
    (value.safetyBackupPath !== undefined &&
      typeof value.safetyBackupPath !== "string")
  ) {
    throw new Error("Pending restore metadata is invalid.");
  }
  return {
    version: METADATA_VERSION,
    status: "pending_restart",
    backupId: value.backupId,
    fileName: value.fileName,
    expectedPayloadSha256: value.expectedPayloadSha256,
    scheduledAt: value.scheduledAt,
    ...(value.safetyBackupPath
      ? { safetyBackupPath: value.safetyBackupPath }
      : {})
  };
}

function fallbackPendingRestore(now: Date): PendingRestore {
  return {
    version: METADATA_VERSION,
    status: "pending_restart",
    backupId: "unknown",
    fileName: "Unknown backup",
    expectedPayloadSha256: "",
    scheduledAt: now.toISOString()
  };
}

function failedRestoreStatus(
  pending: PendingRestore,
  error: string,
  safetyBackupPath: string | null,
  now: Date
): RestoreStatus {
  return {
    version: METADATA_VERSION,
    status: "failed",
    backupId: pending.backupId,
    fileName: pending.fileName,
    requestedAt: pending.scheduledAt,
    completedAt: now.toISOString(),
    safetyBackupPath,
    error: boundPersistedError(error)
  };
}

async function acquireRestoreOwnership(
  directory: string,
  clock: Clock
): Promise<RestoreOwner> {
  const ownerPath = join(directory, OWNER_FILE);
  const deadline = clock.now().getTime() + RESTORE_OWNER_WAIT_MS;

  for (; ;) {
    const owner: RestoreOwner = {
      version: METADATA_VERSION,
      token: randomUUID(),
      pid: process.pid,
      startedAt: clock.now().toISOString()
    };
    let descriptor: number | null = null;
    try {
      descriptor = openSync(ownerPath, "wx", 0o600);
      writeFileSync(
        descriptor,
        `${JSON.stringify(owner, null, 2)}\n`,
        "utf8"
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      syncDirectory(directory);
      return owner;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const ownerState = inspectRestoreOwner(ownerPath, clock);
    if (ownerState === "stale") {
      quarantineStaleRestoreOwner(ownerPath, directory);
      continue;
    }
    if (clock.now().getTime() >= deadline) {
      throw new Error(
        "Timed out waiting for another Dayflow process to finish startup restore coordination."
      );
    }
    await delay(RESTORE_OWNER_POLL_MS);
  }
}

function inspectRestoreOwner(path: string, clock: Clock): "active" | "stale" {
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(path);
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "stale" : "active";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return "stale";
  const age = clock.now().getTime() - stats.mtimeMs;
  if (age > RESTORE_OWNER_STALE_MS) return "stale";

  try {
    const value = readManagedJson(path);
    if (
      !isObject(value) ||
      value.version !== METADATA_VERSION ||
      typeof value.token !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(value.token) ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) <= 0 ||
      typeof value.startedAt !== "string" ||
      !Number.isFinite(Date.parse(value.startedAt))
    ) {
      return age < 2_000 ? "active" : "stale";
    }
    if (
      clock.now().getTime() - Date.parse(value.startedAt) >
      RESTORE_OWNER_STALE_MS
    ) {
      return "stale";
    }
    return processIsAlive(Number(value.pid)) ? "active" : "stale";
  } catch {
    return age < 2_000 ? "active" : "stale";
  }
}

function quarantineStaleRestoreOwner(path: string, directory: string) {
  const quarantinePath = join(
    directory,
    `.${OWNER_FILE}.${process.pid}.${randomUUID()}.stale`
  );
  try {
    renameSync(path, quarantinePath);
    syncDirectory(directory);
    rmSync(quarantinePath, { force: true });
    syncDirectory(directory);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function releaseRestoreOwnership(
  directory: string,
  owner: RestoreOwner
) {
  const ownerPath = join(directory, OWNER_FILE);
  try {
    const current = readManagedJson(ownerPath);
    if (
      isObject(current) &&
      current.token === owner.token &&
      current.pid === owner.pid
    ) {
      rmSync(ownerPath, { force: true });
      syncDirectory(directory);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      console.error(
        "[Dayflow restore] Could not release startup restore ownership.",
        error
      );
    }
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function readRestoreStatus(path: string): RestoreStatus | null {
  if (!pathEntryExists(path)) return null;
  try {
    const value = readManagedJson(path);
    if (
      !isObject(value) ||
      value.version !== METADATA_VERSION ||
      (value.status !== "succeeded" && value.status !== "failed") ||
      typeof value.backupId !== "string" ||
      typeof value.fileName !== "string" ||
      typeof value.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(value.requestedAt)) ||
      typeof value.completedAt !== "string" ||
      !Number.isFinite(Date.parse(value.completedAt)) ||
      (value.safetyBackupPath !== null &&
        typeof value.safetyBackupPath !== "string")
    ) {
      return null;
    }
    return value as RestoreStatus;
  } catch {
    return null;
  }
}

function restoreStatusMatches(
  status: RestoreStatus,
  pending: PendingRestore
) {
  return (
    status.backupId === pending.backupId &&
    status.fileName === pending.fileName &&
    status.requestedAt === pending.scheduledAt
  );
}

function clearRestoreMarkers(directory: string) {
  rmSync(join(directory, APPLYING_FILE), { force: true });
  rmSync(join(directory, PENDING_FILE), { force: true });
  syncDirectory(directory);
}

function verifiedSafetyBackupPath(
  candidate: string | undefined,
  directory: string
) {
  if (!candidate) return null;
  const resolvedCandidate = resolve(candidate);
  if (
    dirname(resolvedCandidate) !== resolve(directory) ||
    !BACKUP_FILE_PATTERN.test(basename(resolvedCandidate))
  ) {
    return null;
  }
  try {
    const opened = openVerifiedManagedBackup(resolvedCandidate);
    closeSync(opened.fileDescriptor);
    return resolvedCandidate;
  } catch {
    return null;
  }
}

function persistedRestoreError(error: unknown, hasSafetyBackup: boolean) {
  const diagnostic = messageFrom(error).toLowerCase();
  if (
    diagnostic.includes("was replaced, but final durability") ||
    diagnostic.includes("release the restore lock cleanly")
  ) {
    return hasSafetyBackup
      ? "The database may have been replaced, but final durability could not be confirmed. Stop Dayflow and recover from the verified safety backup if the active data cannot be opened."
      : "The database may have been replaced, but final durability could not be confirmed. Stop Dayflow and verify the active data before continuing.";
  }
  if (
    diagnostic.includes("checksum") ||
    diagnostic.includes("corrupt") ||
    diagnostic.includes("truncated") ||
    diagnostic.includes("manifest")
  ) {
    return hasSafetyBackup
      ? "The selected backup is corrupt or failed integrity validation and was not restored. A verified safety backup of the prior data is available."
      : "The selected backup is corrupt or failed integrity validation and was not restored.";
  }
  if (
    diagnostic.includes("changed after approval") ||
    diagnostic.includes("changed before startup") ||
    diagnostic.includes("active database changed")
  ) {
    return hasSafetyBackup
      ? "The active database or selected backup changed during restore, so replacement was stopped. A verified safety backup is available."
      : "The active database or selected backup changed during restore, so replacement was stopped.";
  }
  if (
    diagnostic.includes("exclusive access") ||
    diagnostic.includes("sidecar") ||
    diagnostic.includes("busy") ||
    diagnostic.includes("locked")
  ) {
    return hasSafetyBackup
      ? "Dayflow could not obtain exclusive database access, so restore was stopped. A verified safety backup is available."
      : "Dayflow could not obtain exclusive database access, so restore was stopped.";
  }
  if (
    diagnostic.includes("schema") ||
    diagnostic.includes("migration") ||
    diagnostic.includes("foreign-key") ||
    diagnostic.includes("integrity")
  ) {
    return hasSafetyBackup
      ? "The backup is not compatible with this Dayflow release and was not restored. A verified safety backup is available."
      : "The backup is not compatible with this Dayflow release and was not restored.";
  }
  return hasSafetyBackup
    ? "The restore could not be completed. Verify the active data before recovering from the verified safety backup. Technical details were written to the Dayflow server log."
    : "The restore could not be completed. The active data should be verified before another restore is scheduled. Technical details were written to the Dayflow server log.";
}

function boundPersistedError(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PERSISTED_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_PERSISTED_ERROR_LENGTH - 1)}…`;
}

function assertRestoreEnabled(environment: NodeJS.ProcessEnv) {
  if (environment.DAYFLOW_DISABLE_RESTORE === "1") {
    throw new AppError(backupErrors.restoreSchedulingIsDisabledInThisDayflowProcess);
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The restore could not be completed.";
}

export function restoreStateFor(context: BackupContext) {
  return {
    pendingRestore: readMetadataForDisplay(
      join(context.directory, PENDING_FILE),
      "Pending restore metadata could not be read. Cancel it before scheduling another restore."
    ),
    lastRestore: readMetadataForDisplay(
      join(context.directory, STATUS_FILE),
      "The last restore status could not be read."
    )
  };
}
