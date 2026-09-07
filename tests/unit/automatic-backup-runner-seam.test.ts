import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  runDueAutomaticBackup,
  startAutomaticBackupRunner
} from "../../src/modules/data-ops/services/automatic-backup-runner";
import { getAutomaticBackupState, setAutomaticBackupPolicy } from "../../src/modules/data-ops/services/backup-policy";
import { createManagedBackup } from "../../src/modules/data-ops/services/managed-backups";
import { cancelManagedRestore } from "../../src/modules/data-ops/services/restore-coordinator";
import { withAsyncOperation } from "../../src/modules/data-ops/services/managed-backup-storage";

function harness(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-runner-seam-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    repositoryRoot: directory,
    environment: { NODE_ENV: "test" as const,
      DATABASE_URL: `file:${join(directory, "missing.db")}`,
      DAYFLOW_BACKUP_DIRECTORY: join(directory, "backups")
    },
    now: new Date("2026-09-05T12:00:00Z")
  };
}

test("runner seam declines a disabled policy without creating storage or opening a database", { timeout: 1000 }, (t) => {
  const options = harness(t);
  assert.deepEqual(runDueAutomaticBackup(options), {
    status: "skipped", at: options.now.toISOString(), reason: "disabled"
  });
  assert.equal(existsSync(options.environment.DAYFLOW_BACKUP_DIRECTORY), false);
  assert.equal(existsSync(join(options.repositoryRoot, "missing.db")), false);
});

test("runner, manual backups, policy writes and restores share one operation guard", async (t) => {
  const options = harness(t);
  const policy = { enabled: true, intervalHours: 24, retainCount: 7 };
  setAutomaticBackupPolicy(policy, options);
  await withAsyncOperation(async () => {
    await Promise.resolve();
    assert.equal(runDueAutomaticBackup(options).reason, "another backup operation is running");
    for (const operation of [
      () => createManagedBackup(options),
      () => setAutomaticBackupPolicy(policy, options),
      () => cancelManagedRestore(options)
    ]) assert.throws(operation, { code: "CONFLICT", message: "Another backup operation is already running." });
  });
  // Released guard allows the runner to reach the missing-database failure.
  assert.equal(runDueAutomaticBackup(options).status, "failed");
});

test("runner owns the hourly unref'ed recheck and tolerates failed backups on every tick", (t) => {
  const options = harness(t);
  const previous = { ...process.env };
  Object.assign(process.env, options.environment);
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  setAutomaticBackupPolicy({ enabled: true, intervalHours: 24, retainCount: 7 }, options);
  let tick: (() => void) | undefined;
  let unrefCalls = 0;
  t.mock.method(globalThis, "setInterval", (callback: () => void, milliseconds: number) => {
    assert.equal(milliseconds, 60 * 60 * 1000);
    tick = callback;
    return { unref: () => { unrefCalls += 1; } };
  });
  const log = t.mock.method(console, "error", () => undefined);
  assert.doesNotThrow(() => startAutomaticBackupRunner());
  assert.equal(unrefCalls, 1);
  assert.ok(tick);
  assert.doesNotThrow(() => tick!());
  assert.equal(log.mock.calls.length, 2);
  for (const call of log.mock.calls) {
    assert.match(String(call.arguments[0]), /^\[Dayflow backup\] The automatic backup did not complete: /);
  }
  assert.equal(getAutomaticBackupState(options).lastAttempt?.status, "failed");
});
