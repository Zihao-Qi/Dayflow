import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createManagedBackup } from "../../src/modules/data-ops/services/managed-backups";
import {
  applyPendingManagedRestore,
  cancelManagedRestore,
  resolveManagedBackupDownload,
  stageManagedRestore
} from "../../src/modules/data-ops/services/restore-coordinator";

test("restore coordinator cancellation leaves nothing for startup and retains the downloadable copy", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-restore-seam-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "active.db");
  const backupDirectory = join(directory, "backups");
  const options = {
    repositoryRoot: process.cwd(),
    environment: { NODE_ENV: "test" as const, DATABASE_URL: `file:${databasePath}`, DAYFLOW_BACKUP_DIRECTORY: backupDirectory }
  };
  execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
    input: readFileSync(join(process.cwd(), "prisma/init.sql")), stdio: ["pipe", "pipe", "pipe"]
  });
  const originalDatabase = readFileSync(databasePath);
  const backup = createManagedBackup(options);
  const originalArtifact = readFileSync(backup.path);
  stageManagedRestore({
    backupId: backup.id, expectedPayloadSha256: backup.payloadSha256!, confirmation: "RESTORE"
  }, options);
  assert.equal(existsSync(join(backupDirectory, ".dayflow-restore-pending.json")), true);
  cancelManagedRestore(options);
  assert.equal(await applyPendingManagedRestore(options), null);
  assert.deepEqual(readdirSync(backupDirectory), [backup.fileName]);
  assert.deepEqual(readFileSync(databasePath), originalDatabase);
  const download = resolveManagedBackupDownload(backup.id, options);
  try {
    assert.equal(download.fileName, backup.fileName);
    assert.deepEqual(readFileSync(download.fileDescriptor), originalArtifact);
  } finally {
    closeSync(download.fileDescriptor);
  }
});
