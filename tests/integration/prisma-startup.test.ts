import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createManagedBackup,
  getManagedBackupIndex,
  stageManagedRestore
} from "../../src/lib/backup-management";

// Exercise the actual startup hook and bootstrap handler without an HTTP server.
// The separate Next startup gate also verifies framework instrumentation wiring.
test("imported bootstrap leaves Prisma unopened until startup restore has completed", async (t) => {
  const repositoryRoot = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "dayflow-lazy-prisma-startup-"));
  const activeDatabase = join(directory, "active.db");
  const previousEnvironment = { ...process.env };
  const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
  assert.equal(globalForPrisma.prisma, undefined);
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${activeDatabase}`,
    DAYFLOW_BACKUP_DIRECTORY: join(directory, "managed")
  });
  delete process.env.DAYFLOW_DISABLE_RESTORE;
  delete process.env.NEXT_PHASE;
  const options = { repositoryRoot, environment: process.env };
  // Keep startup's unref'ed automatic-backup interval from leaking between tests.
  const intervals: ReturnType<typeof setInterval>[] = [];
  const schedule = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = schedule(...args);
    intervals.push(timer);
    return timer;
  });
  t.after(async () => {
    for (const timer of intervals) clearInterval(timer);
    try {
      await globalForPrisma.prisma?.$disconnect();
    } finally {
      delete globalForPrisma.prisma;
      for (const key of Object.keys(process.env)) {
        if (!(key in previousEnvironment)) delete process.env[key];
      }
      Object.assign(process.env, previousEnvironment);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-database.ts"], {
    cwd: repositoryRoot, env: process.env, stdio: "pipe"
  });
  const sql = (statement: string) => execFileSync(
    "sqlite3", ["-batch", "-bail", activeDatabase, statement], { encoding: "utf8" }
  ).trim();
  sql(`INSERT INTO "Task" ("id", "title", "status", "createdAt", "updatedAt")
       VALUES ('startup-task', 'State from staged backup', 'TODO', 1785000000000, 1785000000000);`);
  const backup = createManagedBackup(options);
  stageManagedRestore({
    backupId: backup.id,
    expectedPayloadSha256: backup.payloadSha256!,
    confirmation: "RESTORE"
  }, options);
  sql(`UPDATE "Task" SET "title" = 'State immediately before restart';
       INSERT INTO "Task" ("id", "title", "status", "createdAt", "updatedAt")
       VALUES ('startup-decoy', 'Must disappear before bootstrap', 'TODO', 1785000001000, 1785000001000);`);

  // Import consumers before the hook to exercise the ordering that was fragile.
  const [{ GET }, { getPrisma }, { registerNodeStartup }] = await Promise.all([
    import("../../src/app/api/bootstrap/route"),
    import("../../src/lib/prisma"),
    import("../../src/instrumentation-node"),
    import("../../src/server/prisma/run-once"),
    import("../../src/lib/focus-sessions")
  ]);
  assert.equal(globalForPrisma.prisma, undefined, "importing consumers must not create a client");
  assert.equal(sql('SELECT title FROM "Task" WHERE id = \'startup-task\';'), "State immediately before restart");

  await registerNodeStartup();
  assert.equal(globalForPrisma.prisma, undefined, "restore must finish before constructing Prisma");
  const index = getManagedBackupIndex(options);
  assert.equal(index.pendingRestore, null);
  assert.equal(index.lastRestore?.status, "succeeded");
  assert.equal(existsSync(index.lastRestore?.safetyBackupPath as string), true);
  assert.equal(sql('SELECT title FROM "Task" WHERE id = \'startup-task\';'), "State from staged backup");
  assert.equal(sql('SELECT count(*) FROM "Task" WHERE id = \'startup-decoy\';'), "0");

  const response = await GET();
  assert.equal(response.status, 200);
  assert.ok(globalForPrisma.prisma, "bootstrap is the first client consumer");
  assert.equal(getPrisma(), globalForPrisma.prisma);
  const body = await response.json();
  assert.equal(body.tasks.find((task: { id: string }) => task.id === "startup-task")?.title, "State from staged backup");
  assert.equal(body.tasks.some((task: { id: string }) => task.id === "startup-decoy"), false);
});
