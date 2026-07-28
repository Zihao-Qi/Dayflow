import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);
const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl();
const databasePath = sqliteDatabasePath(databaseUrl);

if (!existsSync(databasePath)) {
  mkdirSync(dirname(databasePath), { recursive: true });
  execFileSync("sqlite3", [databasePath, "PRAGMA foreign_keys = ON;"]);
}

baselineKnownSchema(databasePath);

runPrisma(["migrate", "deploy"]);
execFileSync("npm", ["run", "evidence:reconcile"], {
  cwd: repositoryRoot,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "inherit"
});

function readDatabaseUrl() {
  const envPath = join(repositoryRoot, ".env");
  if (!existsSync(envPath)) {
    throw new Error("DATABASE_URL is not set and .env could not be found.");
  }
  const match = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envPath, "utf8"));
  if (!match) throw new Error("DATABASE_URL is missing from .env.");
  return match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
}

function sqliteDatabasePath(url: string) {
  if (!url.startsWith("file:")) {
    throw new Error("Dayflow's migration helper currently supports SQLite file URLs.");
  }
  const value = decodeURIComponent(url.slice("file:".length).split("?")[0]);
  if (isAbsolute(value)) return value;
  return resolve(repositoryRoot, "prisma", value);
}

function baselineKnownSchema(path: string) {
  if (!existsSync(path)) return;
  const result = execFileSync(
    "sqlite3",
    [
      path,
      `SELECT
         EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Project'),
         EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'),
         EXISTS(SELECT 1 FROM pragma_table_info('Task') WHERE name = 'focusQueuePosition'),
         (SELECT COUNT(*) FROM pragma_table_info('FocusSession')
          WHERE name IN (
            'needsRecord', 'recordedAt', 'completionNote', 'completionCategory'
          )) = 4,
         EXISTS(SELECT 1 FROM pragma_table_info('FocusSession') WHERE name = 'activeKey'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'origin'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'focusSessionId'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'attributedProjectId'),
         EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Task'),
         EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ActivityEntry'),
         (SELECT COUNT(*) FROM pragma_table_info('MutationReceipt')
          WHERE name IN ('id', 'kind', 'requestHash', 'responseJson')) = 4,
         (
           (SELECT COUNT(*) FROM pragma_table_info('Review')
            WHERE name IN (
              'id', 'periodStart', 'periodEnd', 'narrative',
              'nextPeriodIntention', 'createdAt', 'updatedAt'
            )) = 7
           AND EXISTS(
             SELECT 1
             FROM pragma_index_list('Review')
             WHERE name = 'Review_periodStart_periodEnd_key'
               AND "unique" = 1
           )
           AND (
             SELECT group_concat(name, '|')
             FROM (
               SELECT name
               FROM pragma_index_info('Review_periodStart_periodEnd_key')
               ORDER BY seqno
             )
           ) = 'periodStart|periodEnd'
         );`
    ],
    { encoding: "utf8" }
  ).trim();
  const [
    hasProject,
    hasMigrationHistory,
    hasFocusQueuePosition,
    hasFocusCompletionColumns,
    hasActiveKey,
    hasActivityOrigin,
    hasFocusSessionId,
    hasAttributedProjectId,
    hasTask,
    hasActivityEntry,
    hasMutationReceipt,
    hasCompleteReview
  ] = result.split("|").map((value) => value === "1");
  if (hasMigrationHistory) return;
  if (!hasProject && hasTask) {
    if (!hasActivityEntry) {
      runLegacyUpgrade(path, "pre-activity-to-activity.sql");
    }
    runLegacyUpgrade(path, "pre-project-to-initial.sql");
    runPrisma([
      "migrate",
      "resolve",
      "--applied",
      "20260723000000_initial"
    ]);
    return;
  }
  if (!hasProject) return;

  if (!hasFocusQueuePosition && !hasFocusCompletionColumns) {
    runLegacyUpgrade(path, "project-era-to-initial.sql");
  } else if (!hasFocusQueuePosition && hasFocusCompletionColumns) {
    runLegacyUpgrade(path, "focus-era-to-initial.sql");
  } else if (!hasFocusCompletionColumns) {
    throw new Error(
      "This Project-era database has an unsupported partial Focus schema. Back it up and migrate through a known Dayflow release first."
    );
  }

  runPrisma([
    "migrate",
    "resolve",
    "--applied",
    "20260723000000_initial"
  ]);
  if (hasActiveKey && hasActivityOrigin && hasFocusSessionId) {
    runPrisma([
      "migrate",
      "resolve",
      "--applied",
      "20260727000000_evidence_integrity"
    ]);
  }
  if (hasAttributedProjectId) {
    runPrisma([
      "migrate",
      "resolve",
      "--applied",
      "20260727010000_activity_attribution_snapshot"
    ]);
  }
  if (hasMutationReceipt) {
    runPrisma([
      "migrate",
      "resolve",
      "--applied",
      "20260728000000_mutation_receipts"
    ]);
  }
  if (hasCompleteReview) {
    runPrisma([
      "migrate",
      "resolve",
      "--applied",
      "20260728010000_weekly_reviews"
    ]);
  }
}

function runLegacyUpgrade(path: string, fileName: string) {
  execFileSync("sqlite3", [
    path,
    `.read ${join(
      repositoryRoot,
      "prisma",
      "legacy-upgrades",
      fileName
    )}`
  ]);
}

function runPrisma(args: string[]) {
  execFileSync(process.execPath, [prismaCliPath, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit"
  });
}
