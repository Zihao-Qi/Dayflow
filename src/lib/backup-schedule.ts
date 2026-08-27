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

export class AutomaticBackupPolicyError extends Error {
  constructor(
    message: string,
    readonly field: AutomaticBackupPolicyErrorField
  ) {
    super(message);
    this.name = "AutomaticBackupPolicyError";
  }
}

const POLICY_FIELDS = new Set(["enabled", "intervalHours", "retainCount"]);

function parseBoundedInteger(
  value: unknown,
  field: "intervalHours" | "retainCount",
  min: number,
  max: number,
  label: string
) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new AutomaticBackupPolicyError(
      `${label} must be a whole number between ${min} and ${max}.`,
      field
    );
  }
  return value;
}

/**
 * Parse a policy the user is deliberately setting. Invalid input is rejected
 * rather than repaired, so a malformed request never silently changes the
 * schedule.
 */
export function parseAutomaticBackupPolicy(
  value: unknown
): AutomaticBackupPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutomaticBackupPolicyError(
      "Automatic backup settings must be an object.",
      "policy"
    );
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => !POLICY_FIELDS.has(key));
  if (unknown.length) {
    throw new AutomaticBackupPolicyError(
      `Automatic backup settings do not support ${unknown.sort().join(", ")}.`,
      "policy"
    );
  }
  if (typeof body.enabled !== "boolean") {
    throw new AutomaticBackupPolicyError(
      "Automatic backups must be explicitly turned on or off.",
      "enabled"
    );
  }
  return {
    enabled: body.enabled,
    intervalHours: parseBoundedInteger(
      body.intervalHours,
      "intervalHours",
      AUTOMATIC_BACKUP_MIN_INTERVAL_HOURS,
      AUTOMATIC_BACKUP_MAX_INTERVAL_HOURS,
      "The backup interval in hours"
    ),
    retainCount: parseBoundedInteger(
      body.retainCount,
      "retainCount",
      AUTOMATIC_BACKUP_MIN_RETAIN,
      AUTOMATIC_BACKUP_MAX_RETAIN,
      "The number of automatic backups to keep"
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
