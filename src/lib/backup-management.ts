import type {
  AutomaticBackupAttempt,
  AutomaticBackupPolicy,
  AutomaticBackupState
} from "@/lib/automatic-backup-contract";
import { backupErrors } from "@/lib/backup-errors";
import {
  DEFAULT_AUTOMATIC_BACKUP_POLICY,
  buildRetentionReport,
  parseAutomaticBackupPolicy,
  readStoredAutomaticBackupPolicy,
  resolveAutomaticBackupSchedule
} from "@/lib/backup-schedule";
import { appErrorConstructor } from "@/lib/error-compat";
import { AppError } from "@/shared/kernel/errors";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createDatabaseBackup,
  defaultBackupPath,
  inspectOpenDatabaseBackup,
  resolveActiveDatabase,
  restoreDatabaseBackup,
  type BackupPurpose
} from "../../scripts/database-backup";

export type {
  AutomaticBackupAttempt,
  AutomaticBackupState
} from "@/lib/automatic-backup-contract";

const BACKUP_FILE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.dayflow-backup$/;
const BACKUP_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PENDING_FILE = ".dayflow-restore-pending.json";
const APPLYING_FILE = ".dayflow-restore-applying.json";
const STATUS_FILE = ".dayflow-restore-status.json";
const OWNER_FILE = ".dayflow-restore-owner.json";
const AUTOMATIC_POLICY_FILE = ".dayflow-automatic-backups.json";
const AUTOMATIC_STATUS_FILE = ".dayflow-automatic-status.json";
const METADATA_VERSION = 1;
const RESTORE_OWNER_POLL_MS = 100;
const RESTORE_OWNER_WAIT_MS = 10 * 60 * 1000;
const RESTORE_OWNER_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PERSISTED_ERROR_LENGTH = 600;

export type ManagedBackupSummary = {
  id: string;
  purpose: BackupPurpose;
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

export type ManagedBackupIndex = {
  directory: string;
  automatic: AutomaticBackupState;
  backups: ManagedBackupSummary[];
  pendingRestore: Record<string, unknown> | null;
  lastRestore: Record<string, unknown> | null;
};

export type BackupManagementOptions = {
  repositoryRoot?: string;
  environment?: NodeJS.ProcessEnv;
  now?: Date;
};

type BackupContext = {
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  databasePath: string;
  directory: string;
  directoryExists: boolean;
};

type RestoreOwner = {
  version: typeof METADATA_VERSION;
  token: string;
  pid: number;
  startedAt: string;
};

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const BackupManagementError = appErrorConstructor(
  (
    message: string,
    code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "CORRUPT_BACKUP" | "RESTORE_DISABLED",
    status: 400 | 404 | 409 | 422 | 503,
    field?: string
  ) => new AppError({ status, message, code, ...(field ? { field } : {}) })
);
export type BackupManagementError = AppError;

let operationInProgress = false;

export function getManagedBackupIndex(
  options: BackupManagementOptions = {}
): ManagedBackupIndex {
  const context = resolveBackupContext(options, "read");
  const backups = listBackupFiles(context);
  return {
    directory: context.directory,
    automatic: automaticStateFor(context, backups, options.now),
    backups,
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

export function getAutomaticBackupState(
  options: BackupManagementOptions = {}
): AutomaticBackupState {
  const context = resolveBackupContext(options, "read");
  return automaticStateFor(context, listBackupFiles(context), options.now);
}

/**
 * Persist a deliberate policy change.
 *
 * Changing the policy never creates or removes an artifact. In v1 nothing
 * deletes a backup at all, so lowering the retention preference only changes
 * what is reported.
 */
export function setAutomaticBackupPolicy(
  input: unknown,
  options: BackupManagementOptions = {}
): AutomaticBackupState {
  const policy = parseAutomaticBackupPolicy(input);
  return withOperation(() => {
    const context = resolveBackupContext(options, "mutation");
    writeJsonAtomically(join(context.directory, AUTOMATIC_POLICY_FILE), {
      version: METADATA_VERSION,
      ...policy
    });
    return automaticStateFor(context, listBackupFiles(context), options.now);
  });
}

/**
 * Create an Automatic Backup if one is due.
 *
 * This is the unattended path, so it declines rather than forces: a disabled
 * policy, a pending restore, or another operation already running all mean
 * "not now". Nothing here deletes an artifact.
 */
export function runDueAutomaticBackup(
  options: BackupManagementOptions = {}
): AutomaticBackupAttempt {
  const now = options.now ?? new Date();
  let context: BackupContext;
  try {
    context = resolveBackupContext(options, "read");
  } catch (error) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: describeAutomaticFailure(error)
    };
  }

  const state = automaticStateFor(context, listBackupFiles(context), now);
  if (!state.policy.enabled) {
    return { status: "skipped", at: now.toISOString(), reason: "disabled" };
  }
  if (!state.schedule.due) {
    return { status: "skipped", at: now.toISOString(), reason: "not due" };
  }
  if (restoreIsInFlight(context)) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: "a restore is pending"
    };
  }
  if (operationInProgress) {
    return {
      status: "skipped",
      at: now.toISOString(),
      reason: "another backup operation is running"
    };
  }

  let attempt: AutomaticBackupAttempt;
  try {
    attempt = withOperation(() => {
      const mutable = resolveBackupContext(options, "mutation");
      const result = createDatabaseBackup({
        databasePath: mutable.databasePath,
        outputPath: join(
          mutable.directory,
          basename(defaultBackupPath(mutable.databasePath, "automatic", now))
        ),
        repositoryRoot: mutable.repositoryRoot,
        now
      });
      return {
        status: "succeeded" as const,
        at: now.toISOString(),
        fileName: basename(result.destinationPath)
      };
    });
  } catch (error) {
    attempt = {
      status: "failed",
      at: now.toISOString(),
      reason: describeAutomaticFailure(error)
    };
  }

  recordAutomaticAttempt(context, attempt);
  return attempt;
}

function automaticStateFor(
  context: BackupContext,
  backups: ManagedBackupSummary[],
  now = new Date()
): AutomaticBackupState {
  const policy = readAutomaticPolicy(context);
  const automatic = backups.filter((backup) => backup.purpose === "automatic");
  const stored = readAutomaticStatus(context);
  const artifactSuccessAt = latestVerifiedBackupCreatedAt(automatic);
  const lastSuccessAt = latestIsoTimestamp(
    stored?.lastSuccessAt ?? null,
    artifactSuccessAt
  );
  const lastSuccessDate = lastSuccessAt ? new Date(lastSuccessAt) : null;
  return {
    policy,
    schedule: resolveAutomaticBackupSchedule(policy, lastSuccessDate, now),
    retention: buildRetentionReport(automatic.length, policy.retainCount),
    lastSuccessAt,
    lastAttempt: stored?.lastAttempt ?? null
  };
}

function latestVerifiedBackupCreatedAt(backups: ManagedBackupSummary[]) {
  let latest: string | null = null;
  for (const backup of backups) {
    if (backup.status !== "verified" || !backup.createdAt) continue;
    latest = latestIsoTimestamp(latest, backup.createdAt);
  }
  return latest;
}

function latestIsoTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function readAutomaticPolicy(context: BackupContext): AutomaticBackupPolicy {
  if (!context.directoryExists) {
    return { ...DEFAULT_AUTOMATIC_BACKUP_POLICY };
  }
  const stored = readMetadataForDisplay(
    join(context.directory, AUTOMATIC_POLICY_FILE),
    "Automatic backup settings could not be read."
  );
  if (!stored) return { ...DEFAULT_AUTOMATIC_BACKUP_POLICY };
  const { version: _version, error: _error, ...rest } = stored as Record<
    string,
    unknown
  >;
  return readStoredAutomaticBackupPolicy(rest);
}

type StoredAutomaticStatus = {
  lastSuccessAt: string | null;
  lastAttempt: AutomaticBackupAttempt | null;
};

function readAutomaticStatus(
  context: BackupContext
): StoredAutomaticStatus | null {
  if (!context.directoryExists) return null;
  const stored = readMetadataForDisplay(
    join(context.directory, AUTOMATIC_STATUS_FILE),
    "The last automatic backup status could not be read."
  ) as Record<string, unknown> | null;
  if (!stored) return null;
  const lastSuccessAt =
    typeof stored.lastSuccessAt === "string" &&
      !Number.isNaN(new Date(stored.lastSuccessAt).getTime())
      ? stored.lastSuccessAt
      : null;
  const attempt = stored.lastAttempt as Record<string, unknown> | undefined;
  const lastAttempt =
    attempt &&
      (attempt.status === "succeeded" ||
        attempt.status === "failed" ||
        attempt.status === "skipped") &&
      typeof attempt.at === "string"
      ? ({
        status: attempt.status,
        at: attempt.at,
        ...(typeof attempt.fileName === "string"
          ? { fileName: attempt.fileName }
          : {}),
        ...(typeof attempt.reason === "string"
          ? { reason: attempt.reason }
          : {})
      } as AutomaticBackupAttempt)
      : null;
  return { lastSuccessAt, lastAttempt };
}

/**
 * Persist the attempt so a failure is still visible after a restart.
 * A status write that fails must not turn a good backup into a bad outcome.
 */
function recordAutomaticAttempt(
  context: BackupContext,
  attempt: AutomaticBackupAttempt
) {
  if (attempt.status === "skipped") return;
  try {
    const previous = readAutomaticStatus(context);
    writeJsonAtomically(join(context.directory, AUTOMATIC_STATUS_FILE), {
      version: METADATA_VERSION,
      lastSuccessAt:
        attempt.status === "succeeded" ? attempt.at : previous?.lastSuccessAt ?? null,
      lastAttempt: attempt
    });
  } catch (error) {
    console.error(
      "[Dayflow backup] The automatic backup status could not be recorded.",
      error
    );
  }
}

function restoreIsInFlight(context: BackupContext) {
  if (!context.directoryExists) return false;
  return (
    existsSync(join(context.directory, PENDING_FILE)) ||
    existsSync(join(context.directory, APPLYING_FILE))
  );
}

function describeAutomaticFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_PERSISTED_ERROR_LENGTH);
}

export function createManagedBackup(
  options: BackupManagementOptions = {}
): ManagedBackupSummary {
  return withOperation(() => {
    const context = resolveBackupContext(options, "mutation");
    const now = options.now ?? new Date();
    const outputPath = join(
      context.directory,
      basename(defaultBackupPath(context.databasePath, "manual", now))
    );
    const result = createDatabaseBackup({
      databasePath: context.databasePath,
      outputPath,
      repositoryRoot: context.repositoryRoot,
      now
    });
    return verifiedSummary(result.destinationPath);
  });
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
      scheduledAt: (options.now ?? new Date()).toISOString()
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

    const owner = await acquireRestoreOwnership(context.directory);
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
          interrupted = fallbackPendingRestore();
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
          verifiedSafetyPath
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
        const fallback = fallbackPendingRestore();
        const status = failedRestoreStatus(
          fallback,
          "The scheduled restore metadata was invalid and was discarded. The active database was not intentionally replaced.",
          null
        );
        writeJsonAtomically(statusPath, status);
        clearRestoreMarkers(context.directory);
        return status;
      }

      const safetyBackupPath = join(
        context.directory,
        basename(
          defaultBackupPath(
            context.databasePath,
            "restore-safety",
            options.now ?? new Date()
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
          onProgress: (message) =>
            console.log(`[Dayflow restore] ${message}`)
        });
        const status: RestoreStatus = {
          version: METADATA_VERSION,
          status: "succeeded",
          backupId: pending.backupId,
          fileName: pending.fileName,
          requestedAt: pending.scheduledAt,
          completedAt: new Date().toISOString(),
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
          safetyPath
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

export function isValidBackupId(value: unknown): value is string {
  return typeof value === "string" && BACKUP_ID_PATTERN.test(value);
}

function resolveBackupContext(
  options: BackupManagementOptions,
  access: "read" | "mutation"
): BackupContext {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const environment = options.environment ?? process.env;
  const { databasePath } = resolveActiveDatabase(repositoryRoot, environment);
  const configuredDirectory = environment.DAYFLOW_BACKUP_DIRECTORY?.trim();
  const directory = configuredDirectory
    ? resolve(
      isAbsolute(configuredDirectory) ? configuredDirectory : repositoryRoot,
      isAbsolute(configuredDirectory) ? "." : configuredDirectory
    )
    : join(dirname(databasePath), "backups");

  const directoryExists =
    access === "mutation"
      ? ensureManagedDirectory(directory)
      : inspectManagedDirectory(directory);
  return {
    repositoryRoot,
    environment,
    databasePath,
    directory,
    directoryExists
  };
}

function ensureManagedDirectory(directory: string) {
  if (!inspectManagedDirectory(directory)) {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
  if (!inspectManagedDirectory(directory)) {
    throw new Error("The managed backup directory could not be created.");
  }
  return true;
}

function inspectManagedDirectory(directory: string) {
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AppError(backupErrors.theManagedBackupLocationIsNotASafeDirectory);
  }
  return true;
}

function listBackupFiles(context: BackupContext) {
  if (!context.directoryExists) return [];
  return readdirSync(context.directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && BACKUP_FILE_PATTERN.test(entry.name)
    )
    .map((entry) => summarizeBackup(join(context.directory, entry.name)))
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "verified" ? -1 : 1;
      }
      return sortTimestamp(right) - sortTimestamp(left);
    });
}

/**
 * Resolve a backup's purpose from its own filename label.
 *
 * Order matters: every label starts with "dayflow-", so the specific prefixes
 * must be tested before falling back to manual. Purpose is never inferred from
 * age, size, or position in the directory.
 */
function backupPurposeForFileName(fileName: string): BackupPurpose {
  if (fileName.startsWith("dayflow-automatic-")) return "automatic";
  if (fileName.startsWith("dayflow-safety-before-restore-")) {
    return "restore-safety";
  }
  if (fileName.startsWith("dayflow-safety-before-migration-")) {
    return "migration-safety";
  }
  return "manual";
}

function summarizeBackup(path: string): ManagedBackupSummary {
  const fileName = basename(path);
  let sizeBytes = 0;
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Managed backup is not a regular file.");
    }
    sizeBytes = stats.size;
    return verifiedSummary(path);
  } catch {
    return {
      id: backupIdForFileName(fileName),
      purpose: backupPurposeForFileName(fileName),
      fileName,
      path,
      createdAt: null,
      applicationVersion: null,
      schemaVersion: null,
      sizeBytes,
      payloadBytes: null,
      payloadSha256: null,
      totalRecords: null,
      recordCounts: {},
      status: "invalid",
      error: "This backup could not be verified and cannot be restored."
    };
  }
}

function verifiedSummary(path: string): ManagedBackupSummary {
  const opened = openVerifiedManagedBackup(path);
  try {
    return opened.summary;
  } finally {
    closeSync(opened.fileDescriptor);
  }
}

function openVerifiedManagedBackup(path: string) {
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const stats = fstatSync(fileDescriptor);
    if (!stats.isFile()) {
      throw new Error("Managed backup is not a regular file.");
    }
    const inspection = inspectOpenDatabaseBackup(fileDescriptor, path);
    return {
      fileDescriptor,
      summary: summaryFromInspection(path, inspection)
    };
  } catch (error) {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    throw error;
  }
}

function summaryFromInspection(
  path: string,
  inspection: ReturnType<typeof inspectOpenDatabaseBackup>
): ManagedBackupSummary {
  const recordCounts = { ...inspection.manifest.recordCounts };
  return {
    id: backupIdForFileName(basename(path)),
    purpose: backupPurposeForFileName(basename(path)),
    fileName: basename(path),
    path: inspection.sourcePath,
    createdAt: inspection.manifest.createdAt,
    applicationVersion: inspection.manifest.applicationVersion,
    schemaVersion: inspection.manifest.schemaVersion,
    sizeBytes: inspection.sizeBytes,
    payloadBytes: inspection.manifest.payloadBytes,
    payloadSha256: inspection.manifest.payloadSha256,
    totalRecords: Object.values(recordCounts).reduce(
      (total, count) => total + count,
      0
    ),
    recordCounts,
    status: "verified"
  };
}

function resolveVerifiedBackup(
  backupId: string,
  context: BackupContext
): ManagedBackupSummary & {
  createdAt: string;
  payloadSha256: string;
} {
  const path = resolveManagedBackupPath(backupId, context);
  try {
    const summary = verifiedSummary(path);
    if (!summary.createdAt || !summary.payloadSha256) {
      throw new Error("Backup metadata is incomplete.");
    }
    return summary as ManagedBackupSummary & {
      createdAt: string;
      payloadSha256: string;
    };
  } catch {
    throw new AppError(backupErrors.theSelectedBackupIsCorruptOrIncompatibleAndCannotBeRestored);
  }
}

function resolveManagedBackupPath(
  backupId: string,
  context: BackupContext
) {
  if (!isValidBackupId(backupId)) {
    throw new AppError(backupErrors.theBackupIdentifierIsInvalid);
  }
  if (!context.directoryExists) {
    throw new AppError(backupErrors.theSelectedBackupCouldNotBeFound);
  }
  const entry = readdirSync(context.directory, { withFileTypes: true }).find(
    (candidate) =>
      candidate.isFile() &&
      BACKUP_FILE_PATTERN.test(candidate.name) &&
      backupIdForFileName(candidate.name) === backupId
  );
  if (!entry) {
    throw new AppError(backupErrors.theSelectedBackupCouldNotBeFound);
  }
  return join(context.directory, entry.name);
}

function backupIdForFileName(fileName: string) {
  return createHash("sha256")
    .update(`dayflow-managed-backup:${fileName}`)
    .digest("base64url");
}

function sortTimestamp(backup: ManagedBackupSummary) {
  if (backup.createdAt) {
    const created = Date.parse(backup.createdAt);
    if (Number.isFinite(created)) return created;
  }
  try {
    const stats = lstatSync(backup.path);
    return stats.isSymbolicLink() ? 0 : stats.mtimeMs;
  } catch {
    return 0;
  }
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

function readMetadataForDisplay(path: string, failureMessage: string) {
  if (!pathEntryExists(path)) return null;
  try {
    const value = readManagedJson(path);
    return isObject(value)
      ? value
      : { status: "failed", error: failureMessage };
  } catch {
    return { status: "failed", error: failureMessage };
  }
}

function fallbackPendingRestore(): PendingRestore {
  return {
    version: METADATA_VERSION,
    status: "pending_restart",
    backupId: "unknown",
    fileName: "Unknown backup",
    expectedPayloadSha256: "",
    scheduledAt: new Date().toISOString()
  };
}

function failedRestoreStatus(
  pending: PendingRestore,
  error: string,
  safetyBackupPath: string | null
): RestoreStatus {
  return {
    version: METADATA_VERSION,
    status: "failed",
    backupId: pending.backupId,
    fileName: pending.fileName,
    requestedAt: pending.scheduledAt,
    completedAt: new Date().toISOString(),
    safetyBackupPath,
    error: boundPersistedError(error)
  };
}

async function acquireRestoreOwnership(
  directory: string
): Promise<RestoreOwner> {
  const ownerPath = join(directory, OWNER_FILE);
  const deadline = Date.now() + RESTORE_OWNER_WAIT_MS;

  for (; ;) {
    const owner: RestoreOwner = {
      version: METADATA_VERSION,
      token: randomUUID(),
      pid: process.pid,
      startedAt: new Date().toISOString()
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

    const ownerState = inspectRestoreOwner(ownerPath);
    if (ownerState === "stale") {
      quarantineStaleRestoreOwner(ownerPath, directory);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "Timed out waiting for another Dayflow process to finish startup restore coordination."
      );
    }
    await delay(RESTORE_OWNER_POLL_MS);
  }
}

function inspectRestoreOwner(path: string): "active" | "stale" {
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(path);
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "stale" : "active";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return "stale";
  const age = Date.now() - stats.mtimeMs;
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
      Date.now() - Date.parse(value.startedAt) >
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

function readManagedJson(path: string): unknown {
  const descriptor = openSync(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  );
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > MAX_METADATA_BYTES) {
      throw new Error("Managed backup metadata is not a safe regular file.");
    }
    return JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } finally {
    closeSync(descriptor);
  }
}

function pathEntryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function assertRestoreEnabled(environment: NodeJS.ProcessEnv) {
  if (environment.DAYFLOW_DISABLE_RESTORE === "1") {
    throw new AppError(backupErrors.restoreSchedulingIsDisabledInThisDayflowProcess);
  }
}

function writeJsonAtomically(path: string, value: unknown) {
  const directory = dirname(path);
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, path);
    syncDirectory(directory);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function syncDirectory(path: string) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function withOperation<T>(operation: () => T): T {
  if (operationInProgress) {
    throw new AppError(backupErrors.anotherBackupOperationIsAlreadyRunning);
  }
  operationInProgress = true;
  try {
    return operation();
  } finally {
    operationInProgress = false;
  }
}

async function withAsyncOperation<T>(operation: () => Promise<T>) {
  if (operationInProgress) {
    throw new AppError(backupErrors.anotherBackupOperationIsAlreadyRunning);
  }
  operationInProgress = true;
  try {
    return await operation();
  } finally {
    operationInProgress = false;
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The restore could not be completed.";
}

function errorCode(error: unknown) {
  return isObject(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
