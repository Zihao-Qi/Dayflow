import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyPendingManagedRestore,
  BackupManagementError,
  cancelManagedRestore,
  createManagedBackup,
  getManagedBackupIndex,
  stageManagedRestore
} from "../../src/lib/backup-management";

const repositoryRoot = process.cwd();

test(
  "listing a missing managed directory is side-effect free while mutations initialize it safely",
  { timeout: 120_000 },
  () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-managed-directory-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "managed");
    const environment = {
      ...process.env,
      DATABASE_URL: `file:${activeDatabase}`,
      DAYFLOW_BACKUP_DIRECTORY: backupDirectory
    };
    const options = { repositoryRoot, environment };

    try {
      migrate(activeDatabase);
      assert.equal(existsSync(backupDirectory), false);

      const emptyIndex = getManagedBackupIndex(options);
      assert.equal(emptyIndex.directory, backupDirectory);
      assert.deepEqual(emptyIndex.backups, []);
      assert.equal(emptyIndex.pendingRestore, null);
      assert.equal(emptyIndex.lastRestore, null);
      assert.equal(
        existsSync(backupDirectory),
        false,
        "Reading the managed backup index must not create its directory."
      );

      const created = createManagedBackup(options);
      assert.equal(created.status, "verified");
      assert.equal(existsSync(backupDirectory), true);
      assert.equal(existsSync(created.path), true);

      const nonDirectory = join(temporaryDirectory, "not-a-directory");
      writeFileSync(nonDirectory, "unsafe", "utf8");
      assert.throws(
        () =>
          getManagedBackupIndex({
            ...options,
            environment: {
              ...environment,
              DAYFLOW_BACKUP_DIRECTORY: nonDirectory
            }
          }),
        (error: unknown) =>
          error instanceof BackupManagementError &&
          error.code === "CONFLICT"
      );

      const linkedDirectory = join(temporaryDirectory, "linked-directory");
      symlinkSync(backupDirectory, linkedDirectory);
      assert.throws(
        () =>
          getManagedBackupIndex({
            ...options,
            environment: {
              ...environment,
              DAYFLOW_BACKUP_DIRECTORY: linkedDirectory
            }
          }),
        (error: unknown) =>
          error instanceof BackupManagementError &&
          error.code === "CONFLICT"
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

test(
  "managed backups are path-safe and a staged restore runs before startup",
  { timeout: 120_000 },
  async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-managed-backup-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "managed");
    const outsideArtifact = join(
      temporaryDirectory,
      "outside.dayflow-backup"
    );
    const environment = {
      ...process.env,
      DATABASE_URL: `file:${activeDatabase}`,
      DAYFLOW_BACKUP_DIRECTORY: backupDirectory
    };
    const options = { repositoryRoot, environment };

    try {
      migrate(activeDatabase);
      executeSql(
        activeDatabase,
        `INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'kept-task', 'State captured in backup', 'TODO',
           1785000000000, 1785000000000
         );`
      );

      const created = createManagedBackup(options);
      assert.equal(created.status, "verified");
      assert.equal(created.recordCounts.Task, 1);
      assert.equal(existsSync(created.path), true);

      copyFileSync(created.path, outsideArtifact);
      symlinkSync(
        outsideArtifact,
        join(backupDirectory, "linked.dayflow-backup")
      );
      const corruptPath = join(
        backupDirectory,
        "corrupt.dayflow-backup"
      );
      copyFileSync(created.path, corruptPath);
      truncateSync(corruptPath, 32);

      const initialIndex = getManagedBackupIndex(options);
      assert.equal(initialIndex.backups.length, 2);
      assert.equal(initialIndex.backups[0]?.id, created.id);
      assert.equal(
        initialIndex.backups.find(
          (backup) => backup.fileName === "corrupt.dayflow-backup"
        )?.status,
        "invalid"
      );
      assert.equal(
        initialIndex.backups.some(
          (backup) => backup.fileName === "linked.dayflow-backup"
        ),
        false
      );

      assert.throws(
        () =>
          stageManagedRestore(
            {
              backupId: "../../outside.dayflow-backup",
              expectedPayloadSha256: created.payloadSha256!,
              confirmation: "RESTORE"
            },
            options
          ),
        (error: unknown) =>
          error instanceof BackupManagementError &&
          error.code === "VALIDATION_ERROR"
      );
      assert.throws(
        () =>
          stageManagedRestore(
            {
              backupId: created.id,
              expectedPayloadSha256: created.payloadSha256!,
              confirmation: "restore"
            },
            options
          ),
        (error: unknown) =>
          error instanceof BackupManagementError &&
          error.field === "confirmation"
      );

      stageManagedRestore(
        {
          backupId: created.id,
          expectedPayloadSha256: created.payloadSha256!,
          confirmation: "RESTORE"
        },
        options
      );
      assert.equal(getManagedBackupIndex(options).pendingRestore?.status, "pending_restart");
      cancelManagedRestore(options);
      assert.equal(getManagedBackupIndex(options).pendingRestore, null);

      stageManagedRestore(
        {
          backupId: created.id,
          expectedPayloadSha256: created.payloadSha256!,
          confirmation: "RESTORE"
        },
        options
      );
      executeSql(
        activeDatabase,
        `UPDATE "Task"
            SET "title" = 'Changed after backup',
                "updatedAt" = 1785000001000
          WHERE "id" = 'kept-task';
         INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'decoy-task', 'Should disappear', 'TODO',
           1785000001000, 1785000001000
         );`
      );

      const status = await applyPendingManagedRestore(options);
      assert.equal(status?.status, "succeeded");
      assert.equal(status?.backupId, created.id);
      assert.equal(Boolean(status?.safetyBackupPath), true);
      assert.equal(existsSync(status?.safetyBackupPath ?? ""), true);
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT title FROM "Task" WHERE id = 'kept-task';`
        ),
        "State captured in backup"
      );
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT COUNT(*) FROM "Task" WHERE id = 'decoy-task';`
        ),
        "0"
      );

      const restoredIndex = getManagedBackupIndex(options);
      assert.equal(restoredIndex.pendingRestore, null);
      assert.equal(restoredIndex.lastRestore?.status, "succeeded");
      assert.equal(
        restoredIndex.lastRestore?.safetyBackupPath,
        status?.safetyBackupPath
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

test(
  "a staged artifact changed before startup is rejected without replacing active data or reporting a missing safety copy",
  { timeout: 120_000 },
  async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-managed-changed-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "managed");
    const environment = {
      ...process.env,
      DATABASE_URL: `file:${activeDatabase}`,
      DAYFLOW_BACKUP_DIRECTORY: backupDirectory
    };
    const options = { repositoryRoot, environment };

    try {
      migrate(activeDatabase);
      executeSql(
        activeDatabase,
        `INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'changed-task', 'State captured in backup', 'TODO',
           1785000000000, 1785000000000
         );`
      );
      const created = createManagedBackup(options);
      stageManagedRestore(
        {
          backupId: created.id,
          expectedPayloadSha256: created.payloadSha256!,
          confirmation: "RESTORE"
        },
        options
      );

      executeSql(
        activeDatabase,
        `UPDATE "Task"
            SET "title" = 'Latest active state',
                "updatedAt" = 1785000001000
          WHERE "id" = 'changed-task';`
      );
      truncateSync(created.path, 32);

      const status = await applyPendingManagedRestore(options);
      assert.equal(status?.status, "failed");
      assert.match(status?.error ?? "", /corrupt|changed|incompatible/i);
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT title FROM "Task" WHERE id = 'changed-task';`
        ),
        "Latest active state"
      );
      assert.equal(getManagedBackupIndex(options).pendingRestore, null);
      assert.equal(
        status?.safetyBackupPath === null ||
          existsSync(status?.safetyBackupPath ?? ""),
        true,
        "A failed restore must not report a safety-backup path unless that file exists."
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

test(
  "an interrupted applying marker preserves and reports an existing safety copy without changing active data",
  { timeout: 120_000 },
  async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-managed-interrupted-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "managed");
    const environment = {
      ...process.env,
      DATABASE_URL: `file:${activeDatabase}`,
      DAYFLOW_BACKUP_DIRECTORY: backupDirectory
    };
    const options = { repositoryRoot, environment };

    try {
      migrate(activeDatabase);
      executeSql(
        activeDatabase,
        `INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'interrupted-task', 'State captured in backup', 'TODO',
           1785000000000, 1785000000000
         );`
      );
      const created = createManagedBackup(options);
      stageManagedRestore(
        {
          backupId: created.id,
          expectedPayloadSha256: created.payloadSha256!,
          confirmation: "RESTORE"
        },
        options
      );

      executeSql(
        activeDatabase,
        `UPDATE "Task"
            SET "title" = 'Active state at interrupted startup',
                "updatedAt" = 1785000001000
          WHERE "id" = 'interrupted-task';`
      );
      const safetyCopy = createManagedBackup(options);
      const pendingPath = join(
        backupDirectory,
        ".dayflow-restore-pending.json"
      );
      const applyingPath = join(
        backupDirectory,
        ".dayflow-restore-applying.json"
      );
      const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as Record<
        string,
        unknown
      >;
      renameSync(pendingPath, applyingPath);
      writeFileSync(
        applyingPath,
        `${JSON.stringify(
          { ...pending, safetyBackupPath: safetyCopy.path },
          null,
          2
        )}\n`,
        "utf8"
      );

      const status = await applyPendingManagedRestore(options);
      assert.equal(status?.status, "failed");
      assert.match(status?.error ?? "", /stopped before completion/i);
      assert.equal(status?.safetyBackupPath, safetyCopy.path);
      assert.equal(existsSync(safetyCopy.path), true);
      assert.equal(existsSync(pendingPath), false);
      assert.equal(existsSync(applyingPath), false);
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT title FROM "Task" WHERE id = 'interrupted-task';`
        ),
        "Active state at interrupted startup"
      );
      const index = getManagedBackupIndex(options);
      assert.equal(index.pendingRestore, null);
      assert.equal(index.lastRestore?.status, "failed");
      assert.equal(index.lastRestore?.safetyBackupPath, safetyCopy.path);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

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

function executeSql(databasePath: string, sql: string) {
  execFileSync("sqlite3", ["-batch", "-bail", databasePath, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function queryValue(databasePath: string, sql: string) {
  return execFileSync(
    "sqlite3",
    ["-batch", "-bail", "-noheader", databasePath, sql],
    { encoding: "utf8" }
  ).trim();
}
