import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = process.cwd();

const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
) as { scripts: Record<string, string> };

// The documented fresh-clone path is `cp .env.example .env && npm run db:setup`.
// Nothing in CI exercises that path, because CI supplies DATABASE_URL through
// the environment. These assertions stand in for the missing coverage: they
// fail if a seed command stops reading .env on its own.

test("db:setup runs migrations before seeding", () => {
  assert.equal(
    packageManifest.scripts["db:setup"],
    "npm run db:migrate && npm run prisma:seed"
  );
});

test("the seed command loads .env instead of assuming an ambient DATABASE_URL", () => {
  const seed = packageManifest.scripts["prisma:seed"];
  assert.match(
    seed,
    /--env-file(-if-exists)?=\.env/,
    `prisma:seed must load .env itself; it currently runs "${seed}". ` +
      "Without it, a fresh clone fails with 'Environment variable not found: DATABASE_URL'."
  );
});

test("the destructive demo reset reuses the same env-loading seed command", () => {
  assert.equal(
    packageManifest.scripts["db:reset-demo"],
    "DAYFLOW_SEED_RESET=1 npm run prisma:seed"
  );
});

test(".env.example supplies the DATABASE_URL a fresh clone needs", () => {
  const example = readFileSync(join(repositoryRoot, ".env.example"), "utf8");
  assert.match(example, /^\s*(?:export\s+)?DATABASE_URL\s*=\s*\S+/m);
});
