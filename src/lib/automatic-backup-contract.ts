/**
 * Browser-safe wire contract for Automatic Backup policy and status.
 *
 * Scheduling and filesystem modules implement this contract; UI callers use
 * the same shapes and decoder instead of maintaining a parallel copy.
 */

export type AutomaticBackupPolicy = {
  enabled: boolean;
  intervalHours: number;
  retainCount: number;
};

export type AutomaticBackupSchedule = {
  due: boolean;
  nextDueAt: string | null;
};

export type RetentionReport = {
  automaticCount: number;
  retainCount: number;
  beyondRetention: number;
};

export type AutomaticBackupAttempt = {
  status: "succeeded" | "failed" | "skipped";
  at: string;
  fileName?: string;
  reason?: string;
};

export type AutomaticBackupState = {
  policy: AutomaticBackupPolicy;
  schedule: AutomaticBackupSchedule;
  retention: RetentionReport;
  lastSuccessAt: string | null;
  lastAttempt: AutomaticBackupAttempt | null;
};

export function isAutomaticBackupState(
  value: unknown
): value is AutomaticBackupState {
  if (!isObject(value)) return false;
  const policy = value.policy;
  const schedule = value.schedule;
  const retention = value.retention;
  const attempt = value.lastAttempt;
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
    (value.lastSuccessAt === null || typeof value.lastSuccessAt === "string") &&
    (attempt === null ||
      (isObject(attempt) &&
        (attempt.status === "succeeded" ||
          attempt.status === "failed" ||
          attempt.status === "skipped") &&
        typeof attempt.at === "string" &&
        (attempt.fileName === undefined ||
          typeof attempt.fileName === "string") &&
        (attempt.reason === undefined || typeof attempt.reason === "string")))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
