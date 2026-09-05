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

    await context.test("a missing table also keeps the migration-required envelope", async () => {
      await prisma.$disconnect();
      rmSync(databasePath);
      execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
        cwd: repositoryRoot,
        input: readFileSync(join(repositoryRoot, "prisma/init.sql"), "utf8") +
          '\nDROP TABLE "Task";',
        stdio: ["pipe", "pipe", "pipe"]
      });

      const missingTableResponse = await loadBootstrap();
      assert.equal(missingTableResponse.status, 503);
      assert.deepEqual(await missingTableResponse.json(), {
        code: "DATABASE_MIGRATION_REQUIRED",
        error:
          "Dayflow's local database needs an update. Stop Dayflow, run `npm run db:migrate`, then start Dayflow again."
      });
    });
  }
);
