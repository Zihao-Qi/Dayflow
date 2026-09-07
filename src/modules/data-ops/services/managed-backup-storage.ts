import { type Clock } from "@/shared/kernel/calendar";
import { backupErrors } from "@/lib/backup-errors";
import { appErrorConstructor } from "@/lib/error-compat";
import { AppError } from "@/shared/kernel/errors";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
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
import {
  createDatabaseBackup,
  defaultBackupPath,
  inspectOpenDatabaseBackup,
  resolveActiveDatabase,
  type BackupPurpose
} from "./sqlite-backup-engine";

export const BACKUP_FILE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.dayflow-backup$/;

const BACKUP_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const METADATA_VERSION = 1;

const MAX_METADATA_BYTES = 64 * 1024;

export const MAX_PERSISTED_ERROR_LENGTH = 600;

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

export type BackupManagementOptions = {
  repositoryRoot?: string;
  environment?: NodeJS.ProcessEnv;
  now?: Date;
  /** Live clock for startup completion and ownership deadlines; now only anchors the artifact. */
  clock?: Clock;
};

export type BackupContext = {
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  databasePath: string;
  directory: string;
  directoryExists: boolean;
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

export function isValidBackupId(value: unknown): value is string {
  return typeof value === "string" && BACKUP_ID_PATTERN.test(value);
}

export function resolveBackupContext(
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

export function listBackupFiles(context: BackupContext) {
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

export function verifiedSummary(path: string): ManagedBackupSummary {
  const opened = openVerifiedManagedBackup(path);
  try {
    return opened.summary;
  } finally {
    closeSync(opened.fileDescriptor);
  }
}

export function openVerifiedManagedBackup(path: string) {
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

export function resolveVerifiedBackup(
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

export function resolveManagedBackupPath(
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

export function readMetadataForDisplay(path: string, failureMessage: string) {
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

export function readManagedJson(path: string): unknown {
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

export function pathEntryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export function writeJsonAtomically(path: string, value: unknown) {
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

export function syncDirectory(path: string) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function withOperation<T>(operation: () => T): T {
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

export async function withAsyncOperation<T>(operation: () => Promise<T>) {
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

export function errorCode(error: unknown) {
  return isObject(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** One guard shared by manual backups, automatic backups, policy writes and restores. */
export function isBackupOperationInProgress() {
  return operationInProgress;
}

/** Caller holds the operation guard; both manual and automatic creation use this path. */
export function createManagedBackupArtifact(
  context: BackupContext,
  purpose: "manual" | "automatic",
  now: Date
) {
  const outputPath = join(
    context.directory,
    basename(defaultBackupPath(context.databasePath, purpose, now))
  );
  return createDatabaseBackup({
    databasePath: context.databasePath,
    outputPath,
    repositoryRoot: context.repositoryRoot,
    now
  });
}
