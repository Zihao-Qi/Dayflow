import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATIC_BACKUP_MAX_INTERVAL_HOURS,
  AUTOMATIC_BACKUP_MAX_RETAIN,
  AutomaticBackupPolicyError,
  DEFAULT_AUTOMATIC_BACKUP_POLICY,
  buildRetentionReport,
  parseAutomaticBackupPolicy,
  readStoredAutomaticBackupPolicy,
  resolveAutomaticBackupSchedule
} from "../../src/lib/backup-schedule";

const valid = { enabled: true, intervalHours: 24, retainCount: 7 };

function rejection(value: unknown) {
  try {
    parseAutomaticBackupPolicy(value);
  } catch (error) {
    assert.ok(error instanceof AutomaticBackupPolicyError);
    return error;
  }
  throw new assert.AssertionError({
    message: `expected ${JSON.stringify(value)} to be rejected`
  });
}

test("automatic backups are off by default", () => {
  assert.equal(DEFAULT_AUTOMATIC_BACKUP_POLICY.enabled, false);
});

test("a deliberate policy round trips exactly", () => {
  assert.deepEqual(parseAutomaticBackupPolicy(valid), valid);
  assert.deepEqual(
    parseAutomaticBackupPolicy({ ...valid, enabled: false }),
    { ...valid, enabled: false }
  );
});

test("policy mutations reject malformed values with a named field", () => {
  const cases: Array<[unknown, string]> = [
    [null, "policy"],
    ["enabled", "policy"],
    [[], "policy"],
    [{ ...valid, surprise: 1 }, "policy"],
    [{ intervalHours: 24, retainCount: 7 }, "enabled"],
    [{ ...valid, enabled: "yes" }, "enabled"],
    [{ ...valid, intervalHours: 0 }, "intervalHours"],
    [{ ...valid, intervalHours: 1.5 }, "intervalHours"],
    [{ ...valid, intervalHours: AUTOMATIC_BACKUP_MAX_INTERVAL_HOURS + 1 }, "intervalHours"],
    [{ ...valid, intervalHours: "24" }, "intervalHours"],
    [{ ...valid, retainCount: 0 }, "retainCount"],
    [{ ...valid, retainCount: AUTOMATIC_BACKUP_MAX_RETAIN + 1 }, "retainCount"],
    [{ ...valid, retainCount: Number.NaN }, "retainCount"]
  ];
  for (const [value, field] of cases) {
    assert.equal(rejection(value).field, field, JSON.stringify(value));
  }
});

test("an unreadable stored policy reads as disabled rather than guessing", () => {
  for (const stored of [null, undefined, "", 3, [], { enabled: "yes" }, {}]) {
    const policy = readStoredAutomaticBackupPolicy(stored);
    assert.equal(policy.enabled, false, JSON.stringify(stored));
    assert.deepEqual(policy, DEFAULT_AUTOMATIC_BACKUP_POLICY);
  }
  // A well-formed stored policy is still honoured.
  assert.deepEqual(readStoredAutomaticBackupPolicy(valid), valid);
});

test("a disabled policy is never due", () => {
  const schedule = resolveAutomaticBackupSchedule(
    { ...valid, enabled: false },
    null,
    new Date("2026-08-22T12:00:00.000Z")
  );
  assert.deepEqual(schedule, { due: false, nextDueAt: null });
});

test("an enabled policy that has never run is due immediately", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  assert.equal(resolveAutomaticBackupSchedule(valid, null, now).due, true);
  assert.equal(
    resolveAutomaticBackupSchedule(valid, new Date("not a date"), now).due,
    true
  );
});

test("due-ness follows the interval exactly", () => {
  const last = new Date("2026-08-21T12:00:00.000Z");
  const due = new Date("2026-08-22T12:00:00.000Z");
  const justBefore = new Date(due.getTime() - 1);

  assert.equal(resolveAutomaticBackupSchedule(valid, last, justBefore).due, false);
  assert.equal(resolveAutomaticBackupSchedule(valid, last, due).due, true);
  assert.equal(
    resolveAutomaticBackupSchedule(valid, last, justBefore).nextDueAt,
    due.toISOString()
  );

  // A shorter interval brings the same last-run forward.
  const hourly = { ...valid, intervalHours: 1 };
  assert.equal(
    resolveAutomaticBackupSchedule(hourly, last, new Date("2026-08-21T13:00:00.000Z")).due,
    true
  );
});

test("retention is reported, never enforced", () => {
  assert.deepEqual(buildRetentionReport(10, 7), {
    automaticCount: 10,
    retainCount: 7,
    beyondRetention: 3
  });
  assert.equal(buildRetentionReport(3, 7).beyondRetention, 0);
  assert.equal(buildRetentionReport(0, 7).beyondRetention, 0);
  assert.equal(buildRetentionReport(-5, -5).beyondRetention, 0);
});
