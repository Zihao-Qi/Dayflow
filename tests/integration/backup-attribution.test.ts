import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDatabaseBackup,
  inspectDatabaseBackup,
  restoreDatabaseBackup
} from "../../src/modules/data-ops/services/sqlite-backup-engine";

const repositoryRoot = process.cwd();
const now = new Date("2026-10-13T12:00:00Z");

const transitions = [
  { name: "unchanged Task", sql: "", taskId: "task", currentProject: "a" },
  { name: "Task reassigned A to B", sql: "UPDATE Task SET projectId = 'b' WHERE id = 'task';", taskId: "task", currentProject: "b" },
  { name: "Task moved A to B and back", sql: "UPDATE Task SET projectId = 'b' WHERE id = 'task'; UPDATE Task SET projectId = 'a' WHERE id = 'task';", taskId: "task", currentProject: "a" },
  { name: "Task deleted", sql: "DELETE FROM Task WHERE id = 'task';", taskId: null, currentProject: null },
  {
    name: "direct Focus history survives an unprojected Task gaining Project B",
    initialSql: "UPDATE Task SET projectId = NULL; UPDATE FocusSession SET projectId = 'a'; UPDATE ActivityEntry SET projectId = 'a' WHERE id IN ('manual', 'focus');",
    sql: "UPDATE Task SET projectId = 'b' WHERE id = 'task';",
    taskId: "task", currentProject: "b", directProject: "a"
  }
];

test("backup and restore safety copies preserve historical attribution after Task changes", { timeout: 120_000 }, async context => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-backup-attribution-"));
  try {
    const template = join(directory, "template.db");
    initialize(template);
    for (const [index, transition] of transitions.entries()) {
      await context.test(transition.name, async () => {
        const databasePath = join(directory, `active-${index}.db`);
        copyFileSync(template, databasePath);
        if (transition.initialSql) {
          // Direct Project A is valid at creation while the linked Task has no
          // Project. Task updates do not rewrite completed Focus/evidence links.
          sql(databasePath, transition.initialSql);
          createDatabaseBackup({ databasePath, outputPath: join(directory, `initial-${index}.dayflow-backup`), repositoryRoot, now });
        }
        sql(databasePath, `PRAGMA foreign_keys = ON; ${transition.sql}`);
        const expected = evidence(transition.taskId, transition.directProject ?? null);
        assert.deepEqual(readEvidence(databasePath), expected);
        assert.deepEqual(query(databasePath, "PRAGMA foreign_key_check;"), []);
        const expectedTask = transition.taskId ? [{ projectId: transition.currentProject }] : [];
        assert.deepEqual(readTaskPlacement(databasePath), expectedTask);

        const backupPath = join(directory, `history-${index}.dayflow-backup`);
        const beforeBackup = hash(databasePath);
        // Real public entrypoint: the original validator fails here for move/delete.
        createDatabaseBackup({ databasePath, outputPath: backupPath, repositoryRoot, now });
        assert.equal(hash(databasePath), beforeBackup, "backup must not rewrite history");
        assert.equal(inspectDatabaseBackup(backupPath).manifest.recordCounts.ActivityEntry, 3);

        sql(databasePath, "INSERT INTO Note (id, content, date, updatedAt) VALUES ('latest', 'Latest active data', 1, 1);");
        const result = await restoreDatabaseBackup({ databasePath, backupPath, repositoryRoot, now });
        assert.ok(result.safetyBackupPath, "restore over existing data must retain a safety backup");
        assert.deepEqual(readEvidence(databasePath), expected);
        assert.deepEqual(readTaskPlacement(databasePath), expectedTask);
        assert.deepEqual(query(databasePath, "SELECT id FROM Note WHERE id = 'latest';"), []);
        assert.deepEqual(query(databasePath, "PRAGMA foreign_key_check;"), []);

        // Restore the safety artifact too: its payload must contain the latest
        // active dataset, not just report a plausible manifest/checksum.
        const safetyCopy = join(directory, `safety-recovered-${index}.db`);
        const recovered = await restoreDatabaseBackup({
          databasePath: safetyCopy, backupPath: result.safetyBackupPath, repositoryRoot, now
        });
        assert.equal(recovered.safetyBackupPath, null);
        assert.deepEqual(readEvidence(safetyCopy), expected);
        assert.deepEqual(readTaskPlacement(safetyCopy), expectedTask);
        assert.deepEqual(query(safetyCopy, "SELECT content FROM Note WHERE id = 'latest';"), [{ content: "Latest active data" }]);
        assert.deepEqual(query(safetyCopy, "PRAGMA foreign_key_check;"), []);
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const invalidRelationships = [
  { name: "dangling historical Project", sql: "UPDATE ActivityEntry SET attributedProjectId = 'missing' WHERE id = 'manual';", error: /Foreign-key validation failed/ },
  { name: "dangling Task", sql: "UPDATE ActivityEntry SET taskId = 'missing' WHERE id = 'manual';", error: /Foreign-key validation failed/ },
  { name: "direct Project disagrees with its snapshot", sql: "UPDATE ActivityEntry SET attributedProjectId = 'b' WHERE id = 'direct';", error: /Activity Project attribution validation failed/ },
  { name: "Task Phase belongs to another Project", sql: "UPDATE Task SET phaseId = 'phase-b' WHERE id = 'task';", error: /Task\/Phase attribution validation failed/ },
  { name: "linked Focus Activity has manual origin", sql: "UPDATE ActivityEntry SET origin = 'MANUAL' WHERE id = 'focus';", error: /Focus Session Activity link validation failed/ },
  { name: "completed Focus Session loses its evidence link", sql: "UPDATE ActivityEntry SET focusSessionId = NULL WHERE id = 'focus';", error: /completed Focus Session evidence validation failed/ }
];

test("backup and restore still reject dangling references and invalid persisted relationships", { timeout: 120_000 }, async context => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-backup-invalid-attribution-"));
  try {
    const databasePath = join(directory, "active.db");
    initialize(databasePath);
    const validBackup = join(directory, "valid.dayflow-backup");
    createDatabaseBackup({ databasePath, outputPath: validBackup, repositoryRoot, now });
    const activeHash = hash(databasePath);
    for (const [index, invalid] of invalidRelationships.entries()) {
      await context.test(invalid.name, async () => {
        const malformed = join(directory, `invalid-${index}.db`);
        copyFileSync(databasePath, malformed);
        sql(malformed, invalid.sql); // Deliberately bypass FK enforcement to simulate damaged storage.
        const malformedHash = hash(malformed);
        const rejectedBackup = join(directory, `rejected-${index}.dayflow-backup`);
        assert.throws(() => createDatabaseBackup({ databasePath: malformed, outputPath: rejectedBackup, repositoryRoot, now }), invalid.error);
        assert.equal(existsSync(rejectedBackup), false);
        assert.equal(hash(malformed), malformedHash);

        // A checksum-valid container can still carry broken relationships.
        // Forge only its payload/checksum; schema and row counts stay unchanged.
        const forgedBackup = join(directory, `forged-${index}.dayflow-backup`);
        replacePayload(validBackup, malformed, forgedBackup);
        assert.equal(inspectDatabaseBackup(forgedBackup).checksumVerified, true);
        const safetyBackupPath = join(directory, `safety-${index}.dayflow-backup`);
        await assert.rejects(restoreDatabaseBackup({ databasePath, backupPath: forgedBackup, safetyBackupPath, repositoryRoot, now }), invalid.error);
        assert.equal(hash(databasePath), activeHash, "invalid restore must not replace the active database");
        assert.equal(inspectDatabaseBackup(safetyBackupPath).checksumVerified, true);
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function initialize(databasePath: string) {
  // The fixture URL always points outside the repository. No .env/default DB.
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-database.ts"], {
    cwd: repositoryRoot, env: { ...process.env, DATABASE_URL: `file:${databasePath}` }, stdio: "pipe"
  });
  sql(databasePath, `PRAGMA foreign_keys = ON;
    INSERT INTO Project (id, name, updatedAt) VALUES ('a', 'A', 1), ('b', 'B', 1);
    INSERT INTO ProjectPhase (id, projectId, name, updatedAt) VALUES ('phase-b', 'b', 'B phase', 1);
    INSERT INTO Task (id, title, projectId, updatedAt) VALUES ('task', 'Work', 'a', 1);
    INSERT INTO FocusSession (id, kind, plannedMinutes, actualMinutes, label, startedAt, status, completedAt, needsRecord, recordedAt, taskId, updatedAt)
      VALUES ('session', 'FOCUS', 25, 25, 'Work', 1, 'COMPLETED', 1500001, 0, 1500001, 'task', 1);
    INSERT INTO ActivityEntry (id, startedAt, durationMinutes, category, note, origin, taskId, projectId, attributedProjectId, focusSessionId, updatedAt) VALUES
      ('manual', 1, 10, 'Admin', 'Manual history', 'MANUAL', 'task', NULL, 'a', NULL, 1),
      ('focus', 1, 25, 'Deep Work', 'Focus history', 'FOCUS', 'task', NULL, 'a', 'session', 1),
      ('direct', 1, 5, 'Admin', 'Direct history', 'MANUAL', NULL, 'a', 'a', NULL, 1);
  `);
}

function evidence(taskId: string | null, directProject: string | null = null) {
  return [
    { id: "direct", taskId: null, projectId: "a", attributedProjectId: "a", origin: "MANUAL", durationMinutes: 5, category: "Admin", note: "Direct history", focusSessionId: null },
    { id: "focus", taskId, projectId: directProject, attributedProjectId: "a", origin: "FOCUS", durationMinutes: 25, category: "Deep Work", note: "Focus history", focusSessionId: "session" },
    { id: "manual", taskId, projectId: directProject, attributedProjectId: "a", origin: "MANUAL", durationMinutes: 10, category: "Admin", note: "Manual history", focusSessionId: null }
  ];
}

function readEvidence(databasePath: string) {
  return query(databasePath, "SELECT id, taskId, projectId, attributedProjectId, origin, durationMinutes, category, note, focusSessionId FROM ActivityEntry ORDER BY id;");
}

function readTaskPlacement(databasePath: string) {
  return query(databasePath, "SELECT projectId FROM Task WHERE id = 'task';");
}

function sql(databasePath: string, statement: string) {
  return execFileSync("sqlite3", ["-batch", "-bail", "--", databasePath, statement], { encoding: "utf8" });
}

function query(databasePath: string, statement: string): unknown[] {
  const output = execFileSync("sqlite3", ["-readonly", "-json", "--", databasePath, statement], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) as unknown[] : [];
}

function hash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function replacePayload(validBackup: string, databasePath: string, outputPath: string) {
  const original = readFileSync(validBackup);
  const magic = Buffer.from("DAYFLOW-BACKUP\n");
  assert.ok(original.subarray(0, magic.length).equals(magic));
  const manifestLength = original.readUInt32BE(magic.length);
  const manifest = JSON.parse(original.subarray(magic.length + 4, magic.length + 4 + manifestLength).toString("utf8"));
  const payload = readFileSync(databasePath);
  manifest.payloadBytes = payload.length;
  manifest.payloadSha256 = createHash("sha256").update(payload).digest("hex");
  const encodedManifest = Buffer.from(JSON.stringify(manifest));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encodedManifest.length);
  writeFileSync(outputPath, Buffer.concat([magic, length, encodedManifest, payload]));
}
