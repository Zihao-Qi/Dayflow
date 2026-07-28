import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  createManagedBackup,
  getManagedBackupIndex,
  stageManagedRestore
} from "../../src/lib/backup-management";

const repositoryRoot = process.cwd();
const nextCliPath = join(
  repositoryRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

test(
  "Next startup applies a staged restore before the first bootstrap opens Prisma",
  { timeout: 180_000 },
  async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-startup-restore-test-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "managed");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: `file:${activeDatabase}`,
      DAYFLOW_BACKUP_DIRECTORY: backupDirectory,
      NEXT_TELEMETRY_DISABLED: "1"
    };
    delete environment.DAYFLOW_DISABLE_RESTORE;
    delete environment.NEXT_PHASE;
    const options = { repositoryRoot, environment };
    let server: ReturnType<typeof spawn> | null = null;
    let serverOutput = "";

    try {
      migrate(activeDatabase);
      executeSql(
        activeDatabase,
        `INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'startup-task', 'State from staged backup', 'TODO',
           1785000000000, 1785000000000
         );`
      );
      const backup = createManagedBackup(options);
      stageManagedRestore(
        {
          backupId: backup.id,
          expectedPayloadSha256: backup.payloadSha256!,
          confirmation: "RESTORE"
        },
        options
      );
      executeSql(
        activeDatabase,
        `UPDATE "Task"
            SET "title" = 'State immediately before restart',
                "updatedAt" = 1785000001000
          WHERE "id" = 'startup-task';
         INSERT INTO "Task" (
           "id", "title", "status", "createdAt", "updatedAt"
         ) VALUES (
           'startup-decoy', 'Must disappear before bootstrap', 'TODO',
           1785000001000, 1785000001000
         );`
      );

      const port = await availableLoopbackPort();
      server = spawn(
        process.execPath,
        [
          nextCliPath,
          "dev",
          "-H",
          "127.0.0.1",
          "-p",
          String(port)
        ],
        {
          cwd: repositoryRoot,
          detached: process.platform !== "win32",
          env: environment,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      server.stdout?.setEncoding("utf8");
      server.stderr?.setEncoding("utf8");
      server.stdout?.on("data", (chunk: string) => {
        serverOutput += chunk;
      });
      server.stderr?.on("data", (chunk: string) => {
        serverOutput += chunk;
      });

      const bootstrap = await waitForBootstrap(
        `http://127.0.0.1:${port}/api/bootstrap`,
        server,
        () => serverOutput
      );
      const tasks = Array.isArray(bootstrap.tasks) ? bootstrap.tasks : [];
      assert.equal(
        tasks.find(
          (task): task is Record<string, unknown> =>
            isObject(task) && task.id === "startup-task"
        )?.title,
        "State from staged backup"
      );
      assert.equal(
        tasks.some(
          (task) => isObject(task) && task.id === "startup-decoy"
        ),
        false
      );
      assert.equal(
        queryValue(
          activeDatabase,
          `SELECT title FROM "Task" WHERE id = 'startup-task';`
        ),
        "State from staged backup"
      );

      const index = getManagedBackupIndex(options);
      assert.equal(index.pendingRestore, null);
      assert.equal(index.lastRestore?.status, "succeeded");
      const safetyBackupPath =
        typeof index.lastRestore?.safetyBackupPath === "string"
          ? index.lastRestore.safetyBackupPath
          : "";
      assert.notEqual(safetyBackupPath, "");
      assert.equal(existsSync(safetyBackupPath), true);
    } finally {
      if (server) await stopServer(server);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

async function availableLoopbackPort() {
  return new Promise<number>((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        rejectPort(new Error("Could not allocate a loopback test port."));
        return;
      }
      const port = address.port;
      probe.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(port);
      });
    });
  });
}

async function waitForBootstrap(
  url: string,
  server: ReturnType<typeof spawn>,
  output: () => string
) {
  const deadline = Date.now() + 120_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Next exited before bootstrap was ready (code ${server.exitCode}).\n${output()}`
      );
    }
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) {
        const value: unknown = await response.json();
        if (!isObject(value)) {
          throw new Error("Bootstrap returned a non-object response.");
        }
        return value;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for disposable Next bootstrap: ${lastError}\n${output()}`
  );
}

async function stopServer(server: ReturnType<typeof spawn>) {
  if (server.exitCode !== null) return;
  signalServer(server, "SIGTERM");
  if (!(await waitForServerExit(server, 10_000))) {
    signalServer(server, "SIGKILL");
    await waitForServerExit(server, 5_000);
  }
}

function waitForServerExit(
  server: ReturnType<typeof spawn>,
  timeoutMs: number
) {
  if (server.exitCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolveExit) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    server.once("exit", onExit);
  });
}

function signalServer(
  server: ReturnType<typeof spawn>,
  signal: NodeJS.Signals
) {
  if (process.platform !== "win32" && server.pid) {
    try {
      process.kill(-server.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child below.
    }
  }
  server.kill(signal);
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
