import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../../src/server/prisma/sqlite";
import { parseMaterialCreateInput, parseNoteCreateInput } from "../../src/modules/journal/domain/journal";
import { createMaterial } from "../../src/modules/journal/services/materials";
import { createNote } from "../../src/modules/journal/services/notes";
import { parseTaskPatchInput } from "../../src/modules/planning/domain/task";
import { updateTask } from "../../src/modules/planning/services/tasks";
import {
  assertRecognizedDayflowDatabase,
  createDatabaseBackup,
  inspectDatabaseBackup,
  restoreDatabaseBackup
} from "../../src/modules/data-ops/services/sqlite-backup-engine";
import { migrateActiveDatabase } from "../../src/modules/data-ops/services/sqlite-migration-engine";
import { calendarFor } from "../../src/shared/kernel/calendar";
import { initializeTestDatabase } from "../sqlite-test-helpers";

const repositoryRoot = process.cwd();
const now = new Date("2026-10-13T12:00:00Z");
const calendar = calendarFor("America/Chicago");
type Kind = "Note" | "Material";
type Fixture = { directory: string; databasePath: string; beforePlacement: string };

for (const kind of ["Note", "Material"] as const) {
  test(`${kind}: backup accepts same-Project Task placement without rewriting Journal links`, { timeout: 120_000 }, async () => {
    await withJournal(kind, async ({ directory, databasePath }) => {
      const expected = journalRows(databasePath);
      const before = hash(databasePath);
      const backupPath = join(directory, "after-placement.dayflow-backup");
      assert.doesNotThrow(() => createDatabaseBackup({ databasePath, outputPath: backupPath, repositoryRoot, now }),
        "same-Project Journal data must remain backupable after supported Task placement");
      assert.equal(hash(databasePath), before, "backup must not normalize or rewrite the active database");
      assert.equal(inspectDatabaseBackup(backupPath).manifest.recordCounts[kind], 1);
      assert.deepEqual(journalRows(extractPayload(backupPath, join(directory, "payload.db"))), expected);

      // This also executes the real disposable-copy migration/validation path,
      // not just container inspection or a comparison of two shared serializers.
      const restored = join(directory, "restored.db");
      const result = await restoreDatabaseBackup({ databasePath: restored, backupPath, repositoryRoot, now });
      assert.equal(result.safetyBackupPath, null);
      assert.deepEqual(journalRows(restored), expected);
      assert.deepEqual(query(restored, "SELECT projectId FROM Task WHERE id = 'task';"), [{ projectId: "p" }]);
      assert.deepEqual(query(restored, "PRAGMA foreign_key_check;"), []);
    });
  });

  test(`${kind}: migration recognizes same-Project Journal data and retains a lossless safety copy`, { timeout: 120_000 }, async () => {
    await withJournal(kind, async ({ directory, databasePath }) => {
      const expected = journalRows(databasePath);
      const before = hash(databasePath);
      assert.doesNotThrow(() => assertRecognizedDayflowDatabase(databasePath),
        "migration recognition must accept agreeing Journal and Task Projects");
      assert.equal(hash(databasePath), before);
      // init.sql is deliberately unversioned: exercise recognition, backup,
      // baselining, deploy and reconciliation through the public migration seam.
      const result = migrateActiveDatabase({
        repositoryRoot, environment: { ...process.env, DATABASE_URL: `file:${databasePath}` }, now
      });
      assert.equal(result.safety.kind, "verified-backup");
      if (result.safety.kind !== "verified-backup") throw new Error("Missing migration safety backup");
      const safety = extractPayload(result.safety.backup.destinationPath, join(directory, "migration-safety.db"));
      assert.deepEqual(journalRows(safety), expected);
      assert.deepEqual(query(safety, "SELECT projectId FROM Task WHERE id = 'task';"), [{ projectId: "p" }]);
      assert.deepEqual(journalRows(databasePath), expected);
      assert.deepEqual(query(databasePath, "SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL;"), [{ count: 6 }]);
      assert.deepEqual(query(databasePath, "PRAGMA foreign_key_check;"), []);
    });
  });

  test(`${kind}: restore safety backup accepts same-Project active data and can recover it`, { timeout: 120_000 }, async () => {
    await withJournal(kind, async ({ directory, databasePath, beforePlacement }) => {
      // Restore an earlier standalone-Task snapshot over the now-assigned Task.
      // Failure on the old engine is specifically safety-copy creation, before
      // reading/migrating the source payload, independently of backup acceptance.
      sql(databasePath, "INSERT INTO Task (id, title, updatedAt) VALUES ('latest', 'Latest active work', 1);");
      const expected = journalRows(databasePath);
      const result = await restoreDatabaseBackup({
        databasePath, backupPath: beforePlacement,
        safetyBackupPath: join(directory, "restore-safety.dayflow-backup"), repositoryRoot, now
      }).catch(error => assert.fail(`restore safety-copy creation must accept same-Project active Journal data: ${String(error)}`));
      assert.ok(result.safetyBackupPath, "restore must retain the current assigned dataset");
      assert.deepEqual(journalRows(databasePath), expected);
      assert.deepEqual(query(databasePath, "SELECT projectId FROM Task WHERE id = 'task';"), [{ projectId: null }]);
      assert.deepEqual(query(databasePath, "SELECT id FROM Task WHERE id = 'latest';"), []);
      const recovered = join(directory, "recovered-safety.db");
      await restoreDatabaseBackup({ databasePath: recovered, backupPath: result.safetyBackupPath, repositoryRoot, now });
      assert.deepEqual(journalRows(recovered), expected);
      assert.deepEqual(query(recovered, "SELECT projectId FROM Task WHERE id = 'task';"), [{ projectId: "p" }]);
      assert.deepEqual(query(recovered, "SELECT title FROM Task WHERE id = 'latest';"), [{ title: "Latest active work" }]);
      assert.deepEqual(query(recovered, "PRAGMA foreign_key_check;"), []);
    });
  });

  test(`${kind}: backup, migration recognition and restore still reject damaged Journal relationships`, { timeout: 120_000 }, async context => {
    await withJournal(kind, async ({ directory, databasePath, beforePlacement }) => {
      const invalidRelationships = [
        // Deliberate storage corruption, NOT a supported cross-Project Task
        // transition or a decision about that transition's product policy.
        { name: "conflicting direct Project", column: "projectId", value: "q", error: new RegExp(`${kind}/Task Project attribution validation failed`) },
        { name: "dangling Task", column: "taskId", value: "missing", error: /Foreign-key validation failed/ },
        { name: "dangling Project", column: "projectId", value: "missing", error: /Foreign-key validation failed/ },
        ...(kind === "Material" ? [{ name: "dangling Note provenance", column: "noteId", value: "missing", error: /Foreign-key validation failed/ }] : [])
      ];
      for (const [index, invalid] of invalidRelationships.entries()) {
        await context.test(invalid.name, async () => {
          const malformed = join(directory, `invalid-${index}.db`);
          copyFileSync(databasePath, malformed);
          sql(malformed, `UPDATE "${kind}" SET "${invalid.column}" = '${invalid.value}';`);
          const malformedHash = hash(malformed);
          const rejected = join(directory, `rejected-${index}.dayflow-backup`);
          assert.throws(() => createDatabaseBackup({ databasePath: malformed, outputPath: rejected, repositoryRoot, now }), invalid.error);
          assert.equal(existsSync(rejected), false);
          assert.equal(hash(malformed), malformedHash);
          assert.throws(() => assertRecognizedDayflowDatabase(malformed), /relationship validation failed|Project attribution validation failed/);
          assert.throws(() => migrateActiveDatabase({
            repositoryRoot, environment: { ...process.env, DATABASE_URL: `file:${malformed}` }, now
          }), /relationship validation failed|Project attribution validation failed/);
          assert.equal(hash(malformed), malformedHash, "migration must reject before changing damaged data");

          // Forge a checksum-correct container, so restore must validate the
          // relationships rather than merely rejecting a broken checksum.
          const forged = join(directory, `forged-${index}.dayflow-backup`);
          replacePayload(beforePlacement, malformed, forged);
          assert.equal(inspectDatabaseBackup(forged).checksumVerified, true);
          const active = join(directory, `restore-target-${index}.db`);
          copyFileSync(databasePath, active);
          const activeHash = hash(active);
          const safetyBackupPath = join(directory, `invalid-restore-safety-${index}.dayflow-backup`);
          await assert.rejects(restoreDatabaseBackup({ databasePath: active, backupPath: forged, safetyBackupPath, repositoryRoot, now }), invalid.error);
          assert.equal(hash(active), activeHash, "invalid restore must not replace active data");
          assert.equal(inspectDatabaseBackup(safetyBackupPath).checksumVerified, true);
        });
      }
    });
  });
}

async function withJournal(kind: Kind, run: (fixture: Fixture) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-backup-journal-"));
  const databasePath = join(directory, "active.db");
  const databaseUrl = `file:${databasePath}`;
  initializeTestDatabase(databaseUrl);
  const prisma = new PrismaClient({ adapter: createSqliteAdapter(databaseUrl) });
  try {
    await prisma.project.createMany({ data: [{ id: "p", name: "Project P" }, { id: "q", name: "Project Q" }] });
    await prisma.task.create({ data: { id: "task", title: "Standalone task" } });
    if (kind === "Note") {
      const note = await prisma.$transaction(tx => createNote(tx, parseNoteCreateInput({
        content: "Decision α\nKeep both context links", tags: ["backup", "journal"], date: "2026-10-12", taskId: "task", projectId: "p"
      }, now)));
      assert.equal(note.taskId, "task");
      assert.equal(note.projectId, "p");
      assert.equal(note.content, "Decision α\nKeep both context links");
      assert.equal(note.tags, '["backup","journal"]');
    } else {
      const material = await prisma.$transaction(tx => createMaterial(tx, parseMaterialCreateInput({
        title: "Reference α", url: "https://example.com/reference?q=backup", type: "article", notes: "Keep all supporting context",
        taskId: "task", projectId: "p"
      })));
      assert.equal(material.taskId, "task");
      assert.equal(material.projectId, "p");
      assert.equal(material.noteId, null);
      assert.equal(material.title, "Reference α");
      assert.equal(material.notes, "Keep all supporting context");
    }
    const expected = journalRows(databasePath);
    const beforePlacement = join(directory, "before-placement.dayflow-backup");
    createDatabaseBackup({ databasePath, outputPath: beforePlacement, repositoryRoot, now });
    const changed = await prisma.$transaction(tx => updateTask(tx, "task", parseTaskPatchInput({ projectId: "p" }, now), calendar, now));
    assert.equal(changed.projectId, "p");
    // Settle the supported mutation and close all handles before file-level
    // migration/restore. The engine never reads a live/shared Prisma database.
    await prisma.$disconnect();
    assert.deepEqual(journalRows(databasePath), expected, "Task placement must leave every Journal field/link intact");
    assert.deepEqual(query(databasePath, "PRAGMA foreign_key_check;"), []);
    assert.equal(query(databasePath, `SELECT * FROM "${kind === "Note" ? "Material" : "Note"}";`).length, 0,
      "each record kind must reproduce independently");
    await run({ directory, databasePath, beforePlacement });
  } finally {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
}

function journalRows(databasePath: string) {
  return { notes: query(databasePath, "SELECT * FROM Note ORDER BY id;"), materials: query(databasePath, "SELECT * FROM Material ORDER BY id;") };
}
function sql(databasePath: string, statement: string) {
  execFileSync("sqlite3", ["-batch", "-bail", "--", databasePath, statement], { encoding: "utf8" });
}
function query(databasePath: string, statement: string): unknown[] {
  const output = execFileSync("sqlite3", ["-readonly", "-json", "--", databasePath, statement], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) as unknown[] : [];
}
function hash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function extractPayload(backupPath: string, outputPath: string) {
  const bytes = readFileSync(backupPath);
  const magic = Buffer.from("DAYFLOW-BACKUP\n");
  assert.ok(bytes.subarray(0, magic.length).equals(magic));
  const manifestLength = bytes.readUInt32BE(magic.length);
  const manifest = JSON.parse(bytes.subarray(magic.length + 4, magic.length + 4 + manifestLength).toString("utf8"));
  const payload = bytes.subarray(magic.length + 4 + manifestLength);
  assert.equal(payload.length, manifest.payloadBytes);
  assert.equal(createHash("sha256").update(payload).digest("hex"), manifest.payloadSha256);
  writeFileSync(outputPath, payload);
  return outputPath;
}
function replacePayload(validBackup: string, databasePath: string, outputPath: string) {
  const original = readFileSync(validBackup);
  const magic = Buffer.from("DAYFLOW-BACKUP\n");
  const manifestLength = original.readUInt32BE(magic.length);
  const manifest = JSON.parse(original.subarray(magic.length + 4, magic.length + 4 + manifestLength).toString("utf8"));
  const payload = readFileSync(databasePath);
  manifest.payloadBytes = payload.length;
  manifest.payloadSha256 = createHash("sha256").update(payload).digest("hex");
  const encoded = Buffer.from(JSON.stringify(manifest));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encoded.length);
  writeFileSync(outputPath, Buffer.concat([magic, length, encoded, payload]));
}
