import { backupErrors } from "@/lib/backup-errors";
import { AppError, validation } from "@/shared/kernel/errors";
/**
 * Automatic Backup policy and scheduling.
 *
 * Everything here is pure: it decides what the policy is and whether a backup
 * is due, and never touches the filesystem. v1 performs no deletion, so this
 * module reports against Backup Retention rather than enforcing it.
 *
 * Contract: docs/specs/ROLLING_BACKUPS_V1.md
 */

import type {
  AutomaticBackupPolicy,
  AutomaticBackupSchedule,
  RetentionReport
} from "@/lib/automatic-backup-contract";
import {
  parseBoundedInteger as kernelParseBoundedInteger,
  requireObject
} from "@/shared/kernel/parsing";

export type {
  AutomaticBackupPolicy,
  AutomaticBackupSchedule,
  RetentionReport
} from "@/lib/automatic-backup-contract";

export const AUTOMATIC_BACKUP_MIN_INTERVAL_HOURS = 1;
export const AUTOMATIC_BACKUP_MAX_INTERVAL_HOURS = 168;
export const AUTOMATIC_BACKUP_MIN_RETAIN = 1;
export const AUTOMATIC_BACKUP_MAX_RETAIN = 50;

export const DEFAULT_AUTOMATIC_BACKUP_POLICY: AutomaticBackupPolicy = {
  enabled: false,
  intervalHours: 24,
  retainCount: 7
};

export type AutomaticBackupPolicyErrorField =
  | "enabled"
  | "intervalHours"
  | "retainCount"
  | "policy";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as AutomaticBackupPolicyError };

const POLICY_FIELDS = new Set(["enabled", "intervalHours", "retainCount"]);

function parseBoundedInteger(
  value: unknown,
  field: "intervalHours" | "retainCount",
  min: number,
  max: number,
  label: string
) {
  return kernelParseBoundedInteger(
    value, field, min, max,
    `${label} must be a whole number between ${min} and ${max}.`,
    (message, errorField) => validation(message, errorField)
  );
}

/**
 * Parse a policy the user is deliberately setting. Invalid input is rejected
 * rather than repaired, so a malformed request never silently changes the
 * schedule.
 */
export function parseAutomaticBackupPolicy(
  value: unknown
): AutomaticBackupPolicy {
  const body = requireObject(
    value, "policy", "Automatic backup settings must be an object.",
    (message, field) =>
      validation(message, field)
  );
  const unknown = Object.keys(body).filter((key) => !POLICY_FIELDS.has(key));
  if (unknown.length) {
    throw validation(`Automatic backup settings do not support ${unknown.sort().join(", ")}.`, "policy");
  }
  if (typeof body.enabled !== "boolean") {
    throw new AppError(backupErrors.automaticBackupsMustBeExplicitlyTurnedOnOrOff);
  }
  return {
    enabled: body.enabled,
    intervalHours: parseBoundedInteger(
      body.intervalHours,
      "intervalHours",
      AUTOMATIC_BACKUP_MIN_INTERVAL_HOURS,
      AUTOMATIC_BACKUP_MAX_INTERVAL_HOURS,
      backupErrors.theBackupIntervalInHours.message
    ),
    retainCount: parseBoundedInteger(
      body.retainCount,
      "retainCount",
      AUTOMATIC_BACKUP_MIN_RETAIN,
      AUTOMATIC_BACKUP_MAX_RETAIN,
      backupErrors.theNumberOfAutomaticBackupsToKeep.message
    )
  };
}

/**
 * Read a policy that was previously stored.
 *
 * Anything unreadable is treated as disabled rather than as a reason to guess,
 * matching how Dayflow refuses to guess an active database. A corrupted policy
 * file must never cause unattended writes.
 */
export function readStoredAutomaticBackupPolicy(
  value: unknown
): AutomaticBackupPolicy {
  try {
    return parseAutomaticBackupPolicy(value);
  } catch {
    return { ...DEFAULT_AUTOMATIC_BACKUP_POLICY };
  }
}

/**
 * Decide whether an Automatic Backup is due.
 *
 * A policy that has never produced a successful backup is due immediately, so
 * turning the feature on protects data without waiting a full interval.
 */
export function resolveAutomaticBackupSchedule(
  policy: AutomaticBackupPolicy,
  lastSuccessAt: Date | null,
  now: Date = new Date()
): AutomaticBackupSchedule {
  if (!policy.enabled) {
    return { due: false, nextDueAt: null };
  }
  if (!lastSuccessAt || Number.isNaN(lastSuccessAt.getTime())) {
    return { due: true, nextDueAt: now.toISOString() };
  }
  const nextDue = new Date(
    lastSuccessAt.getTime() + policy.intervalHours * 60 * 60 * 1000
  );
  return {
    due: nextDue.getTime() <= now.getTime(),
    nextDueAt: nextDue.toISOString()
  };
}

/**
 * Report against Backup Retention. v1 deletes nothing, so this is the whole of
 * what retention does.
 */
export function buildRetentionReport(
  automaticCount: number,
  retainCount: number
): RetentionReport {
  const total = Math.max(0, Math.trunc(automaticCount));
  const keep = Math.max(0, Math.trunc(retainCount));
  return {
    automaticCount: total,
    retainCount: keep,
    beyondRetention: Math.max(0, total - keep)
  };
}
