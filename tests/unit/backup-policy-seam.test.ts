import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getAutomaticBackupState,
  setAutomaticBackupPolicy
} from "../../src/modules/data-ops/services/backup-policy";
import { resolveAutomaticBackupSchedule } from "../../src/modules/data-ops/services/backup-schedule";

test("policy seam reports excess automatic copies without changing any artifact", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-policy-seam-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    repositoryRoot: directory,
    environment: { NODE_ENV: "test" as const,
      DATABASE_URL: `file:${join(directory, "unused.db")}`,
      DAYFLOW_BACKUP_DIRECTORY: directory
    },
    now: new Date("2026-09-05T12:00:00Z")
  };
  const names = [
    "dayflow-automatic-one.dayflow-backup",
    "dayflow-automatic-two.dayflow-backup",
    "dayflow-automatic-three.dayflow-backup",
    "dayflow-manual.dayflow-backup",
    "dayflow-safety-before-restore-one.dayflow-backup",
    "dayflow-safety-before-migration-one.dayflow-backup"
  ];
  // Unverifiable copies must also survive; v1 counts automatic filenames even
  // when their contents cannot contribute a successful-backup timestamp.
  for (const name of names) writeFileSync(join(directory, name), `retained ${name}`);
  const state = setAutomaticBackupPolicy(
    { enabled: true, intervalHours: 24, retainCount: 1 }, options
  );
  assert.deepEqual(state.retention, { automaticCount: 3, retainCount: 1, beyondRetention: 2 });
  assert.deepEqual(getAutomaticBackupState(options), state);
  assert.deepEqual(readdirSync(directory).filter(name => name.endsWith(".dayflow-backup")).sort(), names.sort());
  for (const name of names) assert.equal(readFileSync(join(directory, name), "utf8"), `retained ${name}`);
  assert.equal(state.lastSuccessAt, null);
  // The moved arithmetic measures elapsed hours across the fall DST boundary.
  assert.deepEqual(resolveAutomaticBackupSchedule(
    state.policy, new Date("2026-11-01T05:30:00Z"), new Date("2026-11-02T05:29:59Z")
  ), { due: false, nextDueAt: "2026-11-02T05:30:00.000Z" });
});
