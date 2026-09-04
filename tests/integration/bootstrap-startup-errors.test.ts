import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();

test(
  "bootstrap tells the user how to update an outdated database",
  async (context) => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-bootstrap-startup-error-test-")
    );
    const databasePath = join(temporaryDirectory, "outdated.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    let disconnectPrisma: (() => Promise<void>) | null = null;
    process.env.DATABASE_URL = `file:${databasePath.split(sep).join("/")}`;

    context.after(async () => {
      try {
        await disconnectPrisma?.();
      } finally {
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    });

    execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
      cwd: repositoryRoot,
      input: readFileSync(
        join(
          repositoryRoot,
          "prisma/migrations/20260723000000_initial/migration.sql"
        )
      ),
      stdio: ["pipe", "pipe", "pipe"]
    });

    const [{ GET: loadBootstrap }, { prisma }] = await Promise.all([
      import("../../src/app/api/bootstrap/route"),
      import("../../src/lib/prisma")
    ]);
    disconnectPrisma = () => prisma.$disconnect();

    const response = await loadBootstrap();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      code: "DATABASE_MIGRATION_REQUIRED",
      error:
        "Dayflow's local database needs an update. Stop Dayflow, run `npm run db:migrate`, then start Dayflow again."
    });

    const originalFindMany = prisma.task.findMany;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      (prisma.task as unknown as { findMany: unknown }).findMany = async () => {
        throw new Error("unexpected bootstrap failure");
      };
      const internal = await loadBootstrap();
      assert.equal(internal.status, 500);
      assert.deepEqual(await internal.json(), {
        code: "INTERNAL_ERROR",
        error: "Dayflow could not open its local data. Try again."
      });
    } finally {
      (prisma.task as unknown as { findMany: unknown }).findMany =
        originalFindMany;
      console.error = originalConsoleError;
    }
  }
);
