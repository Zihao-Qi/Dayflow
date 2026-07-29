import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  assertDatabaseMatchesBackupPayload,
  assertRecognizedDayflowDatabase,
  createDatabaseBackup,
  defaultBackupPath,
  findApplicationSchemaDifference,
  formatRecordCounts,
  resolveActiveDatabase,
  type BackupResult
} from "./database-backup";

export type MigrationSafety =
  | {
      kind: "verified-backup";
      backup: BackupResult;
    }
  | {
      kind: "not-needed";
      reason: "fresh-database" | "disposable-restore-copy";
    };

export type DatabaseMigrationResult = {
  databasePath: string;
  target: "active-database" | "disposable-restore-copy";
  safety: MigrationSafety;
};

export type DatabaseMigrationPhase =
  | "resolve"
  | "classify"
  | "backup"
  | "initialize"
  | "baseline"
  | "deploy"
  | "reconcile";

export type DatabaseMigrationOptions = {
  repositoryRoot?: string;
  environment?: NodeJS.ProcessEnv;
  onProgress?: (message: string) => void;
};

export type DisposableRestoreCopyMigrationOptions =
  DatabaseMigrationOptions & {
    sourceBackupPath: string;
    expectedPayloadSha256: string;
  };

type MigrationSchemaState = {
  hasProject: boolean;
  hasProjectPhase: boolean;
  hasMigrationHistory: boolean;
  hasFocusQueuePosition: boolean;
  focusCompletionColumnCount: number;
  hasActiveKey: boolean;
  hasActivityOrigin: boolean;
  hasFocusSessionId: boolean;
  hasAttributedProjectId: boolean;
  projectRelationshipColumnCount: number;
  hasTask: boolean;
  hasActivityEntry: boolean;
  hasFocusSession: boolean;
  hasTaskScheduleChange: boolean;
  hasMutationReceipt: boolean;
  hasReview: boolean;
  hasCompleteReview: boolean;
};

const MINIMUM_SUPPORTED_MIGRATION_COLUMNS: Record<
  string,
  readonly string[]
> = {
  ActivityEntry: [
    "id",
    "startedAt",
    "durationMinutes",
    "category",
    "note",
    "taskId",
    "createdAt",
    "updatedAt"
  ],
  Project: [
    "id",
    "name",
    "desiredOutcome",
    "targetDate",
    "targetDurationValue",
    "targetDurationUnit",
    "weeklyMinutesBudget",
    "status",
    "createdAt",
    "updatedAt"
  ],
  ProjectPhase: [
    "id",
    "projectId",
    "name",
    "sortOrder",
    "createdAt",
    "updatedAt"
  ],
  FocusSession: [
    "id",
    "kind",
    "plannedMinutes",
    "actualMinutes",
    "label",
    "startedAt",
    "pausedAt",
    "accumulatedPauseSeconds",
    "status",
    "completedAt",
    "taskId",
    "projectId",
    "createdAt",
    "updatedAt"
  ],
  TaskScheduleChange: [
    "id",
    "taskId",
    "previousDate",
    "nextDate",
    "source",
    "createdAt"
  ],
  MutationReceipt: [
    "id",
    "kind",
    "requestHash",
    "responseJson",
    "createdAt"
  ],
  Review: [
    "id",
    "periodStart",
    "periodEnd",
    "narrative",
    "nextPeriodIntention",
    "createdAt",
    "updatedAt"
  ],
  _prisma_migrations: [
    "id",
    "checksum",
    "finished_at",
    "migration_name",
    "logs",
    "rolled_back_at",
    "started_at",
    "applied_steps_count"
  ]
};

export class DatabaseMigrationError extends Error {
  readonly name = "DatabaseMigrationError";

  constructor(
    message: string,
    readonly facts: {
      phase: DatabaseMigrationPhase;
      databasePath: string | null;
      target: "active-database" | "disposable-restore-copy";
      targetMayHaveChanged: boolean;
      safety: MigrationSafety | null;
    },
    cause: unknown
  ) {
    super(message, { cause });
  }
}

export function migrateActiveDatabase(
  options: DatabaseMigrationOptions = {}
): DatabaseMigrationResult {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const environment = options.environment ?? process.env;
  const progress = options.onProgress ?? (() => undefined);
  let phase: DatabaseMigrationPhase = "resolve";
  let databasePath: string | null = null;
  let safety: MigrationSafety | null = null;
  let targetMayHaveChanged = false;

  try {
    const active = resolveActiveDatabase(repositoryRoot, environment);
    databasePath = active.databasePath;
    progress(`Active database: ${databasePath}`);

    phase = "classify";
    const fresh = isFreshDatabase(databasePath, repositoryRoot);

    if (fresh) {
      safety = { kind: "not-needed", reason: "fresh-database" };
      progress("Migration safety backup: not needed (fresh database).");
    } else {
      phase = "backup";
      const backup = createDatabaseBackup({
        databasePath,
        outputPath: defaultBackupPath(databasePath, "migration-safety"),
        repositoryRoot
      });
      safety = { kind: "verified-backup", backup };
      reportSafetyBackup(progress, backup);
    }

    phase = "initialize";
    if (!existsSync(databasePath)) {
      targetMayHaveChanged = true;
      mkdirSync(dirname(databasePath), { recursive: true });
      execFileSync("sqlite3", [
        databasePath,
        "PRAGMA foreign_keys = ON;"
      ]);
    }

    targetMayHaveChanged = true;
    runMigrationSteps({
      databasePath,
      databaseUrl: active.databaseUrl,
      repositoryRoot,
      environment,
      onPhase: (nextPhase) => {
        phase = nextPhase;
      }
    });

    return {
      databasePath,
      target: "active-database",
      safety
    };
  } catch (error) {
    throw new DatabaseMigrationError(
      errorMessage(error),
      {
        phase,
        databasePath,
        target: "active-database",
        targetMayHaveChanged,
        safety
      },
      error
    );
  }
}

export function migrateDisposableRestoreCopy(
  inputPath: string,
  options: DisposableRestoreCopyMigrationOptions
): DatabaseMigrationResult {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const environment = options.environment ?? process.env;
  const progress = options.onProgress ?? (() => undefined);
  let phase: DatabaseMigrationPhase = "resolve";
  let databasePath: string | null = null;
  let safety: MigrationSafety | null = null;
  let targetMayHaveChanged = false;

  try {
    if (!isAbsolute(inputPath)) {
      throw new Error(
        "The disposable restore copy path must be absolute."
      );
    }
    databasePath = resolve(inputPath);
    progress(`Disposable restore copy: ${databasePath}`);

    phase = "classify";
    if (isFreshDatabase(databasePath, repositoryRoot)) {
      throw new Error(
        "The disposable restore copy does not contain a recognized Dayflow database."
      );
    }
    if (!isAbsolute(options.sourceBackupPath)) {
      throw new Error(
        "The retained source backup path must be absolute."
      );
    }
    assertDatabaseMatchesBackupPayload({
      databasePath,
      backupPath: options.sourceBackupPath,
      expectedPayloadSha256: options.expectedPayloadSha256
    });
    safety = {
      kind: "not-needed",
      reason: "disposable-restore-copy"
    };
    progress(
      `Retained source backup verified: ${resolve(
        options.sourceBackupPath
      )}`
    );
    progress(
      "Migration safety backup: not needed (validated disposable restore copy)."
    );

    targetMayHaveChanged = true;
    runMigrationSteps({
      databasePath,
      databaseUrl: databaseUrlForPath(databasePath),
      repositoryRoot,
      environment,
      onPhase: (nextPhase) => {
        phase = nextPhase;
      }
    });

    return {
      databasePath,
      target: "disposable-restore-copy",
      safety
    };
  } catch (error) {
    throw new DatabaseMigrationError(
      errorMessage(error),
      {
        phase,
        databasePath,
        target: "disposable-restore-copy",
        targetMayHaveChanged,
        safety
      },
      error
    );
  }
}

function reportSafetyBackup(
  progress: (message: string) => void,
  backup: BackupResult
) {
  progress("Migration safety backup verified.");
  progress(`  Safety backup: ${backup.destinationPath}`);
  progress(`  Created: ${backup.manifest.createdAt}`);
  progress(`  Schema version: ${backup.manifest.schemaVersion}`);
  progress(`  Payload SHA-256: ${backup.manifest.payloadSha256}`);
  progress("  Record counts:");
  progress(formatRecordCounts(backup.manifest.recordCounts));
}

function isFreshDatabase(
  databasePath: string,
  repositoryRoot: string
) {
  const stats = lstatSync(databasePath, { throwIfNoEntry: false });
  if (!stats) return true;
  if (stats.isSymbolicLink()) {
    throw new Error(
      "Migration will not modify a symbolic-link database. Point DATABASE_URL at the real SQLite file."
    );
  }
  if (!stats.isFile()) {
    throw new Error("DATABASE_URL must point to a regular SQLite file.");
  }

  const integrityResult = execFileSync(
    "sqlite3",
    ["-readonly", databasePath, "PRAGMA integrity_check;"],
    { encoding: "utf8" }
  ).trim();
  if (integrityResult !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${integrityResult}`);
  }

  const applicationObjectCount = execFileSync(
    "sqlite3",
    [
      "-readonly",
      databasePath,
      `SELECT COUNT(*)
         FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%';`
    ],
    { encoding: "utf8" }
  ).trim();
  if (!/^\d+$/.test(applicationObjectCount)) {
    throw new Error("Could not classify the active SQLite database.");
  }
  if (Number(applicationObjectCount) === 0) return true;

  assertRecognizedDayflowDatabase(databasePath);
  assertSupportedMigrationSchema(
    databasePath,
    readMigrationSchemaState(databasePath),
    repositoryRoot
  );
  return false;
}

function readMigrationSchemaState(
  databasePath: string
): MigrationSchemaState {
  const result = execFileSync(
    "sqlite3",
    [
      "-readonly",
      databasePath,
      `SELECT
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'Project'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'ProjectPhase'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_prisma_migrations'),
         EXISTS(SELECT 1 FROM pragma_table_info('Task') WHERE name = 'focusQueuePosition'),
         (SELECT COUNT(*) FROM pragma_table_info('FocusSession')
          WHERE name IN (
            'needsRecord', 'recordedAt', 'completionNote', 'completionCategory'
          )),
         EXISTS(SELECT 1 FROM pragma_table_info('FocusSession') WHERE name = 'activeKey'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'origin'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'focusSessionId'),
         EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'attributedProjectId'),
         (
           EXISTS(SELECT 1 FROM pragma_table_info('Task') WHERE name = 'projectId')
           + EXISTS(SELECT 1 FROM pragma_table_info('Task') WHERE name = 'phaseId')
           + EXISTS(SELECT 1 FROM pragma_table_info('Note') WHERE name = 'projectId')
           + EXISTS(SELECT 1 FROM pragma_table_info('Material') WHERE name = 'projectId')
           + EXISTS(SELECT 1 FROM pragma_table_info('ActivityEntry') WHERE name = 'projectId')
         ),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'Task'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'ActivityEntry'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'FocusSession'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'TaskScheduleChange'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'MutationReceipt'),
         EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'Review'),
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
  const values = result.split("|");
  if (values.length !== 17) {
    throw new Error("Could not inspect the active Dayflow schema.");
  }
  const booleanAt = (index: number) => values[index] === "1";
  const focusCompletionColumnCount = Number(values[4]);
  const projectRelationshipColumnCount = Number(values[9]);
  if (
    !Number.isInteger(focusCompletionColumnCount) ||
    !Number.isInteger(projectRelationshipColumnCount)
  ) {
    throw new Error("Could not inspect the active Dayflow schema.");
  }
  return {
    hasProject: booleanAt(0),
    hasProjectPhase: booleanAt(1),
    hasMigrationHistory: booleanAt(2),
    hasFocusQueuePosition: booleanAt(3),
    focusCompletionColumnCount,
    hasActiveKey: booleanAt(5),
    hasActivityOrigin: booleanAt(6),
    hasFocusSessionId: booleanAt(7),
    hasAttributedProjectId: booleanAt(8),
    projectRelationshipColumnCount,
    hasTask: booleanAt(10),
    hasActivityEntry: booleanAt(11),
    hasFocusSession: booleanAt(12),
    hasTaskScheduleChange: booleanAt(13),
    hasMutationReceipt: booleanAt(14),
    hasReview: booleanAt(15),
    hasCompleteReview: booleanAt(16)
  };
}

function assertSupportedMigrationSchema(
  databasePath: string,
  state: MigrationSchemaState,
  repositoryRoot: string
) {
  let appliedMigrations: string[] = [];
  const presentProfiles = [
    state.hasActivityEntry && "ActivityEntry",
    state.hasProject && "Project",
    state.hasProjectPhase && "ProjectPhase",
    state.hasFocusSession && "FocusSession",
    state.hasTaskScheduleChange && "TaskScheduleChange",
    state.hasMutationReceipt && "MutationReceipt",
    state.hasReview && "Review",
    state.hasMigrationHistory && "_prisma_migrations"
  ].filter((tableName): tableName is string => Boolean(tableName));

  for (const tableName of presentProfiles) {
    assertTableColumns(
      databasePath,
      tableName,
      MINIMUM_SUPPORTED_MIGRATION_COLUMNS[tableName]
    );
  }
  if (state.hasMigrationHistory) {
    appliedMigrations = assertSupportedMigrationHistory(
      databasePath,
      repositoryRoot
    );
  }

  if (
    state.focusCompletionColumnCount !== 0 &&
    state.focusCompletionColumnCount !== 4
  ) {
    throw unsupportedSchema(
      "Focus Session completion columns are only partially present"
    );
  }

  const evidenceColumnCount = [
    state.hasActiveKey,
    state.hasActivityOrigin,
    state.hasFocusSessionId
  ].filter(Boolean).length;
  if (evidenceColumnCount !== 0 && evidenceColumnCount !== 3) {
    throw unsupportedSchema(
      "Evidence integrity columns are only partially present"
    );
  }

  if (!state.hasProject) {
    if (
      state.hasProjectPhase ||
      state.hasFocusSession ||
      state.hasTaskScheduleChange ||
      state.hasFocusQueuePosition ||
      state.projectRelationshipColumnCount > 0 ||
      evidenceColumnCount > 0 ||
      state.hasAttributedProjectId ||
      state.hasMutationReceipt ||
      state.hasReview ||
      state.hasMigrationHistory
    ) {
      throw unsupportedSchema(
        state.projectRelationshipColumnCount > 0
          ? "Project relationship columns are present without the Project table"
          : "Project-era objects are present without the Project table"
      );
    }
    assertPreProjectUpgradePreflight(
      databasePath,
      repositoryRoot,
      state.hasActivityEntry
    );
    return;
  }

  if (
    !state.hasProjectPhase ||
    !state.hasActivityEntry ||
    !state.hasFocusSession ||
    !state.hasTaskScheduleChange
  ) {
    throw unsupportedSchema(
      "the Project-era table set is incomplete"
    );
  }
  assertTableColumns(databasePath, "Task", [
    "projectId",
    "phaseId"
  ]);
  assertTableColumns(databasePath, "Note", ["projectId"]);
  assertTableColumns(databasePath, "Material", ["projectId"]);
  assertTableColumns(databasePath, "ActivityEntry", ["projectId"]);

  if (
    state.hasFocusQueuePosition &&
    state.focusCompletionColumnCount === 0
  ) {
    throw unsupportedSchema(
      "the Focus schema is only partially present"
    );
  }
  if (state.hasAttributedProjectId && evidenceColumnCount !== 3) {
    throw unsupportedSchema(
      "Activity attribution exists without Evidence integrity"
    );
  }
  if (state.hasMutationReceipt && !state.hasAttributedProjectId) {
    throw unsupportedSchema(
      "Mutation Receipts exist without Activity attribution"
    );
  }
  if (state.hasReview && !state.hasMutationReceipt) {
    throw unsupportedSchema(
      "Reviews exist without Mutation Receipts"
    );
  }
  if (state.hasReview && !state.hasCompleteReview) {
    throw unsupportedSchema(
      "the Review schema or uniqueness constraint is incomplete"
    );
  }
  if (
    evidenceColumnCount > 0 &&
    (
      !state.hasFocusQueuePosition ||
      state.focusCompletionColumnCount !== 4
    )
  ) {
    throw unsupportedSchema(
      "Evidence integrity exists without the complete initial Focus schema"
    );
  }

  assertSupportedApplicationStructure(
    databasePath,
    state,
    repositoryRoot,
    appliedMigrations
  );
}

function assertTableColumns(
  databasePath: string,
  tableName: string,
  requiredColumns: readonly string[]
) {
  const output = execFileSync(
    "sqlite3",
    [
      "-readonly",
      databasePath,
      `SELECT name
         FROM pragma_table_xinfo('${tableName.replaceAll("'", "''")}')
        ORDER BY cid;`
    ],
    { encoding: "utf8" }
  ).trim();
  const columns = output ? output.split("\n") : [];
  const missingColumn = requiredColumns.find(
    (column) => !columns.includes(column)
  );
  if (missingColumn) {
    throw unsupportedSchema(
      `table ${tableName} is missing column ${missingColumn}`
    );
  }
}

function assertPreProjectUpgradePreflight(
  databasePath: string,
  repositoryRoot: string,
  hasActivityEntry: boolean
) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-pre-project-preflight-")
  );
  const disposableDatabase = join(
    temporaryDirectory,
    "preflight.db"
  );

  try {
    execFileSync("sqlite3", [
      databasePath,
      `.backup '${disposableDatabase.replaceAll("'", "''")}'`
    ]);
    if (!hasActivityEntry) {
      runLegacyUpgrade(
        disposableDatabase,
        repositoryRoot,
        "pre-activity-to-activity.sql"
      );
    }
    runLegacyUpgrade(
      disposableDatabase,
      repositoryRoot,
      "pre-project-to-initial.sql"
    );

    const integrity = execFileSync(
      "sqlite3",
      [
        "-readonly",
        disposableDatabase,
        "PRAGMA integrity_check;"
      ],
      { encoding: "utf8" }
    ).trim();
    if (integrity !== "ok") {
      throw new Error(
        `upgraded copy failed SQLite integrity_check: ${integrity}`
      );
    }
    const foreignKeyFailures = execFileSync(
      "sqlite3",
      [
        "-readonly",
        disposableDatabase,
        "PRAGMA foreign_key_check;"
      ],
      { encoding: "utf8" }
    ).trim();
    if (foreignKeyFailures) {
      throw new Error(
        "upgraded copy contains invalid foreign-key relationships"
      );
    }

    const upgradedState = readMigrationSchemaState(
      disposableDatabase
    );
    assertSupportedApplicationStructure(
      disposableDatabase,
      upgradedState,
      repositoryRoot,
      []
    );
  } catch (error) {
    throw unsupportedSchema(
      `pre-Project upgrade preflight failed: ${errorMessage(error)}`
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function assertSupportedMigrationHistory(
  databasePath: string,
  repositoryRoot: string
) {
  const migrationsDirectory = join(
    repositoryRoot,
    "prisma",
    "migrations"
  );
  const expectedMigrations = readdirSync(migrationsDirectory, {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const migrationPath = join(
        migrationsDirectory,
        entry.name,
        "migration.sql"
      );
      return {
        name: entry.name,
        checksum: createHash("sha256")
          .update(readFileSync(migrationPath))
          .digest("hex")
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const output = execFileSync(
    "sqlite3",
    [
      "-readonly",
      "-json",
      databasePath,
      `SELECT
         "migration_name" AS "name",
         "checksum",
         "started_at" AS "startedAt",
         "finished_at" IS NOT NULL AS "finished",
         "rolled_back_at" IS NOT NULL AS "rolledBack"
       FROM "_prisma_migrations"
       ORDER BY "started_at", "id";`
    ],
    { encoding: "utf8" }
  ).trim();
  let history: Array<{
    name: string;
    checksum: string;
    startedAt: string | number;
    finished: number;
    rolledBack: number;
  }>;
  try {
    history = output ? JSON.parse(output) : [];
  } catch {
    throw unsupportedSchema(
      "the Prisma migration history could not be inspected"
    );
  }

  const expectedByName = new Map(
    expectedMigrations.map((migration) => [
      migration.name,
      migration.checksum
    ])
  );
  for (const migration of history) {
    const expectedChecksum = expectedByName.get(migration.name);
    if (!expectedChecksum) {
      throw unsupportedSchema(
        `migration history contains unknown migration ${migration.name}`
      );
    }
    if (migration.checksum !== expectedChecksum) {
      throw unsupportedSchema(
        `migration ${migration.name} does not match the checked-in checksum`
      );
    }
    if (!migration.finished && !migration.rolledBack) {
      throw unsupportedSchema(
        `migration ${migration.name} is incomplete`
      );
    }
    if (
      typeof migration.startedAt !== "string" &&
      typeof migration.startedAt !== "number"
    ) {
      throw unsupportedSchema(
        `migration ${migration.name} has an invalid start time`
      );
    }
  }

  const expectedIndex = new Map(
    expectedMigrations.map((migration, index) => [
      migration.name,
      index
    ])
  );
  const appliedGroups: typeof history[] = [];
  for (const migration of history.filter(
    (entry) => Boolean(entry.finished) && !entry.rolledBack
  )) {
    const group = appliedGroups.at(-1);
    if (
      !group ||
      group[0]?.startedAt !== migration.startedAt
    ) {
      appliedGroups.push([migration]);
    } else {
      group.push(migration);
    }
  }
  const appliedMigrationNames = appliedGroups.flatMap((group) =>
    [...group]
      .sort(
        (left, right) =>
          (expectedIndex.get(left.name) ?? -1) -
          (expectedIndex.get(right.name) ?? -1)
      )
      .map((migration) => migration.name)
  );
  const expectedPrefix = expectedMigrations
    .slice(0, appliedMigrationNames.length)
    .map((migration) => migration.name);
  if (
    appliedMigrationNames.length === 0 ||
    JSON.stringify(appliedMigrationNames) !==
      JSON.stringify(expectedPrefix)
  ) {
    throw unsupportedSchema(
      "the applied Prisma migrations are not a supported prefix"
    );
  }
  return appliedMigrationNames;
}

function assertSupportedApplicationStructure(
  databasePath: string,
  state: MigrationSchemaState,
  repositoryRoot: string,
  appliedMigrations: string[]
) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-migration-schema-")
  );
  const referenceDatabase = join(
    temporaryDirectory,
    "reference.db"
  );

  try {
    const referenceMigrations =
      appliedMigrations.length > 0
        ? appliedMigrations
        : inferredUnversionedMigrations(state);
    for (const migrationName of referenceMigrations) {
      const migrationPath = join(
        repositoryRoot,
        "prisma",
        "migrations",
        migrationName,
        "migration.sql"
      );
      execFileSync("sqlite3", [referenceDatabase], {
        input: readFileSync(migrationPath, "utf8")
      });
    }

    if (!state.hasMigrationHistory) {
      removeAbsentLegacyColumns(referenceDatabase, state);
    }

    const difference = findApplicationSchemaDifference(
      referenceDatabase,
      databasePath
    );
    if (difference) {
      throw unsupportedSchema(
        `${difference.tableName} has unexpected ${
          difference.differingParts.join("/") ||
          "table inventory"
        }`
      );
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function inferredUnversionedMigrations(
  state: MigrationSchemaState
) {
  const migrations = ["20260723000000_initial"];
  if (state.hasActiveKey) {
    migrations.push("20260727000000_evidence_integrity");
  }
  if (state.hasAttributedProjectId) {
    migrations.push(
      "20260727010000_activity_attribution_snapshot"
    );
  }
  if (state.hasMutationReceipt) {
    migrations.push("20260728000000_mutation_receipts");
  }
  if (state.hasCompleteReview) {
    migrations.push("20260728010000_weekly_reviews");
  }
  return migrations;
}

function removeAbsentLegacyColumns(
  referenceDatabase: string,
  state: MigrationSchemaState
) {
  const statements: string[] = [];
  if (!state.hasFocusQueuePosition) {
    statements.push(
      `DROP INDEX "Task_focusQueuePosition_idx"`,
      `ALTER TABLE "Task" DROP COLUMN "focusQueuePosition"`
    );
  }
  if (state.focusCompletionColumnCount === 0) {
    for (const column of [
      "needsRecord",
      "recordedAt",
      "completionNote",
      "completionCategory"
    ]) {
      statements.push(
        `ALTER TABLE "FocusSession" DROP COLUMN "${column}"`
      );
    }
  }
  if (statements.length > 0) {
    execFileSync("sqlite3", [
      referenceDatabase,
      `${statements.join(";\n")};`
    ]);
  }
}

function unsupportedSchema(detail: string) {
  return new Error(
    `This database has an unsupported partial Dayflow schema: ${detail}. Back it up and migrate through a known Dayflow release first.`
  );
}

function runMigrationSteps(options: {
  databasePath: string;
  databaseUrl: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  onPhase: (
    phase: Extract<
      DatabaseMigrationPhase,
      "baseline" | "deploy" | "reconcile"
    >
  ) => void;
}) {
  options.onPhase("baseline");
  baselineKnownSchema(options);

  options.onPhase("deploy");
  runPrisma(
    ["migrate", "deploy"],
    options.databaseUrl,
    options.repositoryRoot,
    options.environment
  );

  options.onPhase("reconcile");
  execFileSync("npm", ["run", "evidence:reconcile"], {
    cwd: options.repositoryRoot,
    env: {
      ...options.environment,
      DATABASE_URL: options.databaseUrl
    },
    stdio: "inherit"
  });
}

function baselineKnownSchema(options: {
  databasePath: string;
  databaseUrl: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}) {
  const {
    databasePath,
    databaseUrl,
    repositoryRoot,
    environment
  } = options;
  const {
    hasProject,
    hasMigrationHistory,
    hasFocusQueuePosition,
    focusCompletionColumnCount,
    hasActiveKey,
    hasActivityOrigin,
    hasFocusSessionId,
    hasAttributedProjectId,
    hasTask,
    hasActivityEntry,
    hasMutationReceipt,
    hasCompleteReview
  } = readMigrationSchemaState(databasePath);
  const hasFocusCompletionColumns =
    focusCompletionColumnCount === 4;
  if (hasMigrationHistory) return;
  if (!hasProject && hasTask) {
    if (!hasActivityEntry) {
      runLegacyUpgrade(
        databasePath,
        repositoryRoot,
        "pre-activity-to-activity.sql"
      );
    }
    runLegacyUpgrade(
      databasePath,
      repositoryRoot,
      "pre-project-to-initial.sql"
    );
    runPrisma(
      ["migrate", "resolve", "--applied", "20260723000000_initial"],
      databaseUrl,
      repositoryRoot,
      environment
    );
    return;
  }
  if (!hasProject) return;

  if (!hasFocusQueuePosition && !hasFocusCompletionColumns) {
    runLegacyUpgrade(
      databasePath,
      repositoryRoot,
      "project-era-to-initial.sql"
    );
  } else if (!hasFocusQueuePosition && hasFocusCompletionColumns) {
    runLegacyUpgrade(
      databasePath,
      repositoryRoot,
      "focus-era-to-initial.sql"
    );
  } else if (!hasFocusCompletionColumns) {
    throw new Error(
      "This Project-era database has an unsupported partial Focus schema. Back it up and migrate through a known Dayflow release first."
    );
  }

  runPrisma(
    ["migrate", "resolve", "--applied", "20260723000000_initial"],
    databaseUrl,
    repositoryRoot,
    environment
  );
  if (hasActiveKey && hasActivityOrigin && hasFocusSessionId) {
    runPrisma(
      [
        "migrate",
        "resolve",
        "--applied",
        "20260727000000_evidence_integrity"
      ],
      databaseUrl,
      repositoryRoot,
      environment
    );
  }
  if (hasAttributedProjectId) {
    runPrisma(
      [
        "migrate",
        "resolve",
        "--applied",
        "20260727010000_activity_attribution_snapshot"
      ],
      databaseUrl,
      repositoryRoot,
      environment
    );
  }
  if (hasMutationReceipt) {
    runPrisma(
      [
        "migrate",
        "resolve",
        "--applied",
        "20260728000000_mutation_receipts"
      ],
      databaseUrl,
      repositoryRoot,
      environment
    );
  }
  if (hasCompleteReview) {
    runPrisma(
      [
        "migrate",
        "resolve",
        "--applied",
        "20260728010000_weekly_reviews"
      ],
      databaseUrl,
      repositoryRoot,
      environment
    );
  }
}

function runLegacyUpgrade(
  databasePath: string,
  repositoryRoot: string,
  fileName: string
) {
  execFileSync("sqlite3", [
    databasePath,
    `.read ${join(
      repositoryRoot,
      "prisma",
      "legacy-upgrades",
      fileName
    )}`
  ]);
}

function runPrisma(
  args: string[],
  databaseUrl: string,
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv
) {
  const prismaCliPath = join(
    repositoryRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js"
  );
  execFileSync(process.execPath, [prismaCliPath, ...args], {
    cwd: repositoryRoot,
    env: { ...environment, DATABASE_URL: databaseUrl },
    stdio: "inherit"
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function databaseUrlForPath(path: string) {
  return `file:${encodeURI(path)
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")}`;
}
