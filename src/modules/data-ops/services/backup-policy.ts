import { systemClock } from "@/shared/kernel/calendar";
import type {
  AutomaticBackupAttempt,
  AutomaticBackupPolicy,
  AutomaticBackupState
} from "@/lib/automatic-backup-contract";
import {
  DEFAULT_AUTOMATIC_BACKUP_POLICY,
  buildRetentionReport,
  parseAutomaticBackupPolicy,
  readStoredAutomaticBackupPolicy,
  resolveAutomaticBackupSchedule
} from "./backup-schedule";
import { join } from "node:path";
import {
  type BackupManagementOptions,
  resolveBackupContext,
  listBackupFiles,
  withOperation,
  writeJsonAtomically,
  METADATA_VERSION,
  type BackupContext,
  type ManagedBackupSummary,
  readMetadataForDisplay
} from "./managed-backup-storage";

const AUTOMATIC_POLICY_FILE = ".dayflow-automatic-backups.json";

const AUTOMATIC_STATUS_FILE = ".dayflow-automatic-status.json";

export function getAutomaticBackupState(
  options: BackupManagementOptions = {}
): AutomaticBackupState {
  const context = resolveBackupContext(options, "read");
  return automaticStateFor(context, listBackupFiles(context), options.now ?? (options.clock ?? systemClock).now());
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
    return automaticStateFor(context, listBackupFiles(context), options.now ?? (options.clock ?? systemClock).now());
  });
}

export function automaticStateFor(
  context: BackupContext,
  backups: ManagedBackupSummary[],
  now: Date
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
export function recordAutomaticAttempt(
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
