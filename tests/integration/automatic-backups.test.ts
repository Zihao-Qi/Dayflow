import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createManagedBackup,
  getAutomaticBackupState,
  getManagedBackupIndex,
  runDueAutomaticBackup,
  setAutomaticBackupPolicy
} from "../../src/lib/backup-management";

const repositoryRoot = process.cwd();

type Harness = {
  options: { repositoryRoot: string; environment: NodeJS.ProcessEnv };
  backupDirectory: string;
  activeDatabase: string;
  artifacts: () => string[];
};

function withHarness(run: (harness: Harness) => void) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-automatic-backup-test-")
  );
  const activeDatabase = join(temporaryDirectory, "active.db");
  const backupDirectory = join(temporaryDirectory, "managed");
  const environment = {
    ...process.env,
    DATABASE_URL: `file:${activeDatabase}`,
    DAYFLOW_BACKUP_DIRECTORY: backupDirectory
  };
  try {
    migrate(activeDatabase);
    run({
      options: { repositoryRoot, environment },
      backupDirectory,
      activeDatabase,
      // A disabled policy never creates the managed directory, which is the
      // behaviour under test rather than a missing precondition.
      artifacts: () =>
        existsSync(backupDirectory)
          ? readdirSync(backupDirectory)
              .filter((name) => name.endsWith(".dayflow-backup"))
              .sort()
          : []
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const enabled = { enabled: true, intervalHours: 24, retainCount: 7 };

test("automatic backups stay off until deliberately enabled", { timeout: 120_000 }, () => {
  withHarness(({ options, artifacts }) => {
    const initial = getAutomaticBackupState(options);
    assert.equal(initial.policy.enabled, false);
    assert.equal(initial.schedule.due, false);

    const attempt = runDueAutomaticBackup(options);
    assert.equal(attempt.status, "skipped");
    assert.equal(attempt.reason, "disabled");
    assert.deepEqual(artifacts(), []);
  });
});

test("an enabled policy creates one verified backup and then waits", { timeout: 120_000 }, () => {
  withHarness(({ options, artifacts }) => {
    setAutomaticBackupPolicy(enabled, options);

    const first = runDueAutomaticBackup(options);
    assert.equal(first.status, "succeeded", first.reason ?? "automatic backup did not succeed");
    assert.equal(artifacts().length, 1);
    assert.ok(artifacts()[0].startsWith("dayflow-automatic-"));

    // Verified by exactly the same path as a manual backup.
    const index = getManagedBackupIndex(options);
    const created = index.backups.find((b) => b.purpose === "automatic");
    assert.ok(created);
    assert.equal(created.status, "verified");
    assert.ok((created.totalRecords ?? 0) >= 0);

    // Not due again inside the interval.
    const second = runDueAutomaticBackup(options);
    assert.equal(second.status, "skipped");
    assert.equal(second.reason, "not due");
    assert.equal(artifacts().length, 1);
  });
});

test("verified automatic artifacts preserve the schedule when status metadata is lost", { timeout: 120_000 }, () => {
  withHarness(({ options, backupDirectory, artifacts }) => {
    const firstRun = new Date("2026-08-26T12:00:00.000Z");
    setAutomaticBackupPolicy(enabled, { ...options, now: firstRun });
    assert.equal(
      runDueAutomaticBackup({ ...options, now: firstRun }).status,
      "succeeded"
    );
    assert.equal(artifacts().length, 1);

    rmSync(join(backupDirectory, ".dayflow-automatic-status.json"), {
      force: true
    });
    const oneHourLater = new Date("2026-08-26T13:00:00.000Z");
    const missingState = getAutomaticBackupState({
      ...options,
      now: oneHourLater
    });
    assert.equal(missingState.lastSuccessAt, firstRun.toISOString());
    assert.equal(missingState.schedule.due, false);
    assert.equal(
      runDueAutomaticBackup({ ...options, now: oneHourLater }).reason,
      "not due"
    );

    writeFileSync(
      join(backupDirectory, ".dayflow-automatic-status.json"),
      "{ corrupt status"
    );
    const corruptState = getAutomaticBackupState({
      ...options,
      now: oneHourLater
    });
    assert.equal(corruptState.lastSuccessAt, firstRun.toISOString());
    assert.equal(corruptState.schedule.due, false);
    assert.equal(artifacts().length, 1);
  });
});

test("v1 deletes nothing: a due-check-and-create leaves every artifact present", { timeout: 240_000 }, () => {
  withHarness(({ options, backupDirectory, artifacts }) => {
    // A manual backup, plus safety artifacts, plus more automatic backups than
    // the retention preference allows.
    const manual = createManagedBackup(options);
    const seed = join(backupDirectory, manual.fileName);
    const planted: string[] = [];
    const plant = (name: string) => {
      copyFileSync(seed, join(backupDirectory, name));
      planted.push(name);
    };
    plant("dayflow-safety-before-restore-20260101-000000-aaaaaaaa.dayflow-backup");
    plant("dayflow-safety-before-migration-20260101-000000-bbbbbbbb.dayflow-backup");
    for (let index = 0; index < 5; index += 1) {
      plant(`dayflow-automatic-2026010${index}-000000-cccccc0${index}.dayflow-backup`);
    }

    setAutomaticBackupPolicy({ ...enabled, retainCount: 1 }, options);
    const before = artifacts();
    const state = getAutomaticBackupState(options);
    assert.equal(state.retention.automaticCount, 5);
    assert.equal(state.retention.beyondRetention, 4);

    assert.ok(manual.createdAt);
    const dueAt = new Date(
      Date.parse(manual.createdAt) + enabled.intervalHours * 60 * 60 * 1000
    );
    const attempt = runDueAutomaticBackup({ ...options, now: dueAt });
    assert.equal(attempt.status, "succeeded", attempt.reason ?? "automatic backup did not succeed");

    const after = artifacts();
    for (const name of [manual.fileName, ...planted]) {
      assert.ok(
        after.includes(name),
        `${name} must survive: v1 deletes no artifact`
      );
    }
    assert.equal(
      after.length,
      before.length + 1,
      "exactly one artifact should have been added and none removed"
    );
  });
});

test("retention is reported against automatic artifacts only", { timeout: 120_000 }, () => {
  withHarness(({ options, backupDirectory }) => {
    const manual = createManagedBackup(options);
    const seed = join(backupDirectory, manual.fileName);
    for (let index = 0; index < 3; index += 1) {
      copyFileSync(
        seed,
        join(
          backupDirectory,
          `dayflow-safety-before-restore-2026010${index}-000000-dddddd0${index}.dayflow-backup`
        )
      );
    }
    setAutomaticBackupPolicy({ ...enabled, retainCount: 2 }, options);

    const state = getAutomaticBackupState(options);
    assert.equal(
      state.retention.automaticCount,
      0,
      "manual and safety artifacts must not count toward retention"
    );
    assert.equal(state.retention.beyondRetention, 0);
  });
});

test("lowering retention deletes nothing on its own", { timeout: 240_000 }, () => {
  withHarness(({ options, artifacts }) => {
    setAutomaticBackupPolicy(enabled, options);
    assert.equal(runDueAutomaticBackup(options).status, "succeeded");
    const before = artifacts();

    const state = setAutomaticBackupPolicy(
      { ...enabled, retainCount: 1 },
      options
    );
    assert.equal(state.policy.retainCount, 1);
    assert.deepEqual(artifacts(), before, "a settings change must not remove data");
  });
});

test("no automatic backup is created while a restore is pending", { timeout: 120_000 }, () => {
  withHarness(({ options, backupDirectory, artifacts }) => {
    setAutomaticBackupPolicy(enabled, options);
    writeFileSync(
      join(backupDirectory, ".dayflow-restore-pending.json"),
      JSON.stringify({ version: 1, status: "pending_restart" })
    );

    const attempt = runDueAutomaticBackup(options);
    assert.equal(attempt.status, "skipped");
    assert.equal(attempt.reason, "a restore is pending");
    assert.deepEqual(artifacts(), []);
  });
});

test("a malformed policy file reads as disabled and creates nothing", { timeout: 120_000 }, () => {
  withHarness(({ options, backupDirectory, artifacts }) => {
    setAutomaticBackupPolicy(enabled, options);
    writeFileSync(
      join(backupDirectory, ".dayflow-automatic-backups.json"),
      "{ this is not json"
    );

    const state = getAutomaticBackupState(options);
    assert.equal(state.policy.enabled, false);
    assert.equal(runDueAutomaticBackup(options).status, "skipped");
    assert.deepEqual(artifacts(), []);
  });
});

test("a failed attempt is reported and survives a restart", { timeout: 240_000 }, () => {
  withHarness(({ options, activeDatabase, artifacts }) => {
    setAutomaticBackupPolicy(enabled, options);
    // Remove the database out from under the backup so creation must fail.
    rmSync(activeDatabase, { force: true });

    const attempt = runDueAutomaticBackup(options);
    assert.equal(attempt.status, "failed");
    assert.ok(attempt.reason && attempt.reason.length > 0);
    assert.deepEqual(artifacts(), [], "a failure must leave no partial artifact");

    // Read fresh, as a restarted process would.
    const state = getAutomaticBackupState(options);
    assert.equal(state.lastAttempt?.status, "failed");
    assert.equal(state.lastSuccessAt, null);
  });
});

function migrate(databasePath: string) {
  execFileSync(
    process.execPath,
    ["--import", "tsx", join(repositoryRoot, "scripts/migrate-database.ts")],
    {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      stdio: "pipe"
    }
  );
}
