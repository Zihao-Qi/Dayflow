import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getAutomaticBackupState,
  runDueAutomaticBackup,
  setAutomaticBackupPolicy
} from "../../src/lib/backup-management";
import { frozenClock } from "../../src/shared/kernel/calendar";

test("backup scheduling uses the injected clock and preserves explicit now precedence", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-backup-clock-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const clock = frozenClock(new Date("2026-09-04T04:59:59.999Z"));
  const options = {
    repositoryRoot: directory,
    environment: {
      NODE_ENV: "test" as const,
      DATABASE_URL: `file:${join(directory, "unused.db")}`,
      DAYFLOW_BACKUP_DIRECTORY: join(directory, "backups")
    },
    clock
  };
  assert.deepEqual(runDueAutomaticBackup(options), {
    status: "skipped",
    at: clock.now().toISOString(),
    reason: "disabled"
  });
  const state = setAutomaticBackupPolicy(
    { enabled: true, intervalHours: 24, retainCount: 7 },
    options
  );
  assert.deepEqual(state.schedule, { due: true, nextDueAt: clock.now().toISOString() });
  const now = new Date("2026-09-05T12:00:00Z");
  assert.deepEqual(getAutomaticBackupState({ ...options, now }).schedule, {
    due: true,
    nextDueAt: now.toISOString()
  });
});
