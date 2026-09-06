import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const BACKUP_MAGIC = Buffer.from("DAYFLOW-BACKUP\n", "utf8");
const MANIFEST_LENGTH_BYTES = 4;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const BACKUP_FORMAT = "dayflow-sqlite";
const BACKUP_FORMAT_VERSION = 1;
const OLDEST_SUPPORTED_DAYFLOW_COLUMNS = {
  Task: [
    "id",
    "title",
    "date",
    "status",
    "priority",
    "urgentScore",
    "importanceScore",
    "deadline",
    "estimateMinutes",
    "actualMinutes",
    "sortOrder",
    "completedAt",
    "createdAt",
    "updatedAt"
  ],
  Note: [
    "id",
    "content",
    "tags",
    "date",
    "taskId",
    "createdAt",
    "updatedAt"
  ],
  DiaryEntry: [
    "id",
    "date",
    "content",
    "reflection",
    "mood",
    "energy",
    "createdAt",
    "updatedAt"
  ],
  Material: [
    "id",
    "title",
    "url",
    "type",
    "notes",
    "taskId",
    "noteId",
    "createdAt",
    "updatedAt"
  ],
  TimeBlock: [
    "id",
    "date",
    "startTime",
    "endTime",
    "title",
    "taskId",
    "createdAt",
    "updatedAt"
  ]
} as const;
const CURRENT_TABLE_COLUMNS: Record<string, string[]> = {
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
  Task: [
    "id",
    "title",
    "date",
    "status",
    "priority",
    "urgentScore",
    "importanceScore",
    "deadline",
    "estimateMinutes",
    "actualMinutes",
    "sortOrder",
    "focusQueuePosition",
    "completedAt",
    "createdAt",
    "updatedAt",
    "projectId",
    "phaseId"
  ],
  Note: [
    "id",
    "content",
    "tags",
    "date",
    "taskId",
    "projectId",
    "createdAt",
    "updatedAt"
  ],
  DiaryEntry: [
    "id",
    "date",
    "content",
    "reflection",
    "mood",
    "energy",
    "createdAt",
    "updatedAt"
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
  Material: [
    "id",
    "title",
    "url",
    "type",
    "notes",
    "taskId",
    "noteId",
    "projectId",
    "createdAt",
    "updatedAt"
  ],
  TimeBlock: [
    "id",
    "date",
    "startTime",
    "endTime",
    "title",
    "taskId",
    "createdAt",
    "updatedAt"
  ],
  ActivityEntry: [
    "id",
    "startedAt",
    "durationMinutes",
    "category",
    "note",
    "origin",
    "taskId",
    "projectId",
    "attributedProjectId",
    "focusSessionId",
    "createdAt",
    "updatedAt"
  ],
  FocusSession: [
    "id",
    "activeKey",
    "kind",
    "plannedMinutes",
    "actualMinutes",
    "label",
    "startedAt",
    "pausedAt",
    "accumulatedPauseSeconds",
    "status",
    "completedAt",
    "needsRecord",
    "recordedAt",
    "completionNote",
    "completionCategory",
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

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  applicationVersion: string;
  schemaVersion: string;
  schemaMigrations: string[];
  schemaHash: string;
  recordCounts: Record<string, number>;
  payloadBytes: number;
  payloadSha256: string;
};

export type BackupResult = {
  sourcePath: string;
  destinationPath: string;
  manifest: BackupManifest;
};

export type BackupInspection = {
  sourcePath: string;
  sizeBytes: number;
  manifest: BackupManifest;
  checksumVerified: true;
};

export type ApplicationSchemaDifference = {
  tableName: string;
  differingParts: Array<
    "columns" | "foreignKeys" | "indexes"
  >;
};

export type BackupPurpose =
  | "manual"
  | "automatic"
  | "restore-safety"
  | "migration-safety";

export type RestoreResult = {
  activeDatabasePath: string;
  sourceBackupPath: string;
  safetyBackupPath: string | null;
  restoredManifest: BackupManifest;
  restoredRecordCounts: Record<string, number>;
  schemaVersion: string;
};

type DatabaseMetadata = {
  tableNames: string[];
  recordCounts: Record<string, number>;
  schemaMigrations: string[];
  schemaVersion: string;
  schemaHash: string;
};

type ArtifactInspection = {
  manifest: BackupManifest;
  payloadOffset: number;
  sizeBytes: number;
};

type FileState = {
  path: string;
  exists: boolean;
  device?: number;
  inode?: number;
  size?: number;
  modifiedMs?: number;
};

export function resolveActiveDatabase(
  repositoryRoot = process.cwd(),
  environment = process.env
) {
  const databaseUrl =
    environment.DATABASE_URL?.trim() || readDatabaseUrlFromEnv(repositoryRoot);
  const databasePath = sqlitePathFromDatabaseUrl(databaseUrl, repositoryRoot);
  return { databaseUrl, databasePath };
}

export function sqlitePathFromDatabaseUrl(
  databaseUrl: string,
  repositoryRoot = process.cwd()
) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL must be a SQLite file URL such as file:./dev.db."
    );
  }

  const encodedPath = databaseUrl.slice("file:".length).split(/[?#]/, 1)[0];
  if (!encodedPath || encodedPath === ":memory:") {
    throw new Error("DATABASE_URL must point to a persistent SQLite file.");
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    throw new Error("DATABASE_URL contains an invalid encoded file path.");
  }
  if (decodedPath.includes("\0")) {
    throw new Error("DATABASE_URL contains an invalid file path.");
  }

  return isAbsolute(decodedPath)
    ? resolve(decodedPath)
    : resolve(repositoryRoot, "prisma", decodedPath);
}

export function defaultBackupPath(
  databasePath: string,
  purpose: BackupPurpose,
  now: Date
) {
  const label: Record<BackupPurpose, string> = {
    manual: "dayflow",
    automatic: "dayflow-automatic",
    "restore-safety": "dayflow-safety-before-restore",
    "migration-safety": "dayflow-safety-before-migration"
  };
  return join(
    dirname(databasePath),
    "backups",
    `${label[purpose]}-${timestampForFile(now)}-${randomUUID().slice(0, 8)}.dayflow-backup`
  );
}

export function createDatabaseBackup(options: {
  databasePath: string;
  outputPath?: string;
  repositoryRoot?: string;
  /** Required: the caller owns the instant. The filename stem and
   * manifest.createdAt are both derived from it, so they cannot disagree. */
  now: Date;
}): BackupResult {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const sourcePath = resolve(options.databasePath);
  const destinationPath = resolve(
    options.outputPath ??
      defaultBackupPath(sourcePath, "manual", options.now)
  );

  assertExistingRegularFile(sourcePath, "active database");
  if (sourcePath === destinationPath) {
    throw new Error("The backup destination cannot be the active database.");
  }
  if (existsSync(destinationPath)) {
    throw new Error(`Backup destination already exists: ${destinationPath}`);
  }

  const destinationDirectory = dirname(destinationPath);
  mkdirSync(destinationDirectory, { recursive: true });
  const temporaryStem = `.${basename(destinationPath)}.${process.pid}.${randomUUID()}`;
  const snapshotPath = join(destinationDirectory, `${temporaryStem}.sqlite`);
  const artifactPath = join(destinationDirectory, `${temporaryStem}.partial`);

  try {
    createConsistentSnapshot(sourcePath, snapshotPath);
    const metadata = validateSqliteDatabase(snapshotPath, {
      requireCurrentSchema: false
    });
    const payload = hashFile(snapshotPath);
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: options.now.toISOString(),
      applicationVersion: readApplicationVersion(repositoryRoot),
      schemaVersion: metadata.schemaVersion,
      schemaMigrations: metadata.schemaMigrations,
      schemaHash: metadata.schemaHash,
      recordCounts: metadata.recordCounts,
      payloadBytes: payload.bytes,
      payloadSha256: payload.sha256
    };

    writeArtifact(artifactPath, snapshotPath, manifest);
    inspectBackupArtifact(artifactPath);
    syncFile(artifactPath);
    renameSync(artifactPath, destinationPath);
    syncDirectory(destinationDirectory);

    return { sourcePath, destinationPath, manifest };
  } finally {
    removeTemporaryFile(snapshotPath);
    removeTemporaryFile(artifactPath);
  }
}

export function assertRecognizedDayflowDatabase(databasePath: string) {
  const resolvedDatabasePath = resolve(databasePath);
  assertExistingRegularFile(resolvedDatabasePath, "Dayflow database");
  const tableNames = databaseTableNames(resolvedDatabasePath);
  validateRecognizedDayflowSchema(resolvedDatabasePath, tableNames);
  validateSemanticRelationships(resolvedDatabasePath, tableNames);
}

export function assertDatabaseMatchesBackupPayload(options: {
  databasePath: string;
  backupPath: string;
  expectedPayloadSha256: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedPayloadSha256)) {
    throw new Error("The expected backup payload checksum is invalid.");
  }
  const inspection = inspectDatabaseBackup(options.backupPath);
  if (
    inspection.manifest.payloadSha256 !==
    options.expectedPayloadSha256
  ) {
    throw new Error(
      "The retained source backup does not match the expected payload checksum."
    );
  }
  const databasePayload = hashFile(resolve(options.databasePath));
  if (databasePayload.sha256 !== options.expectedPayloadSha256) {
    throw new Error(
      "The disposable restore copy does not exactly match the retained source backup."
    );
  }
}

export function inspectDatabaseBackup(backupPath: string): BackupInspection {
  const sourcePath = resolve(backupPath);
  const inspection = inspectBackupArtifact(sourcePath);
  return {
    sourcePath,
    sizeBytes: inspection.sizeBytes,
    manifest: inspection.manifest,
    checksumVerified: true
  };
}

export function inspectOpenDatabaseBackup(
  fileDescriptor: number,
  sourcePath: string
): BackupInspection {
  const resolvedSourcePath = resolve(sourcePath);
  const stats = fstatSync(fileDescriptor);
  if (!stats.isFile()) {
    throw new Error("The backup artifact is not a regular file.");
  }
  const inspection = inspectBackupFileDescriptor(
    fileDescriptor,
    stats.size
  );
  return {
    sourcePath: resolvedSourcePath,
    sizeBytes: inspection.sizeBytes,
    manifest: inspection.manifest,
    checksumVerified: true
  };
}

export async function restoreDatabaseBackup(options: {
  databasePath: string;
  backupPath: string;
  repositoryRoot?: string;
  safetyBackupPath?: string;
  expectedPayloadSha256?: string;
  /** Required: the safety backup's filename stem and its manifest.createdAt
   * are both derived from this one instant. */
  now: Date;
  onProgress?: (message: string) => void;
}): Promise<RestoreResult> {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const activeDatabasePath = resolve(options.databasePath);
  const sourceBackupPath = resolve(options.backupPath);
  const safetyBackupPath = resolve(
    options.safetyBackupPath ??
      defaultBackupPath(activeDatabasePath, "restore-safety", options.now)
  );
  const progress = options.onProgress ?? (() => undefined);

  assertExistingRegularFile(sourceBackupPath, "backup artifact");
  if (
    options.expectedPayloadSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.expectedPayloadSha256)
  ) {
    throw new Error("The expected backup payload checksum is invalid.");
  }
  const rejectBackupSymlink =
    options.expectedPayloadSha256 !== undefined;
  if (
    rejectBackupSymlink &&
    lstatSync(sourceBackupPath).isSymbolicLink()
  ) {
    throw new Error(
      "The scheduled backup is a symbolic link and was not restored."
    );
  }
  const activeDatabaseExisted = existsSync(activeDatabasePath);
  if (activeDatabaseExisted) {
    assertExistingRegularFile(activeDatabasePath, "active database");
  } else {
    mkdirSync(dirname(activeDatabasePath), { recursive: true });
  }
  if (
    activeDatabaseExisted &&
    lstatSync(activeDatabasePath).isSymbolicLink()
  ) {
    throw new Error(
      "Restore will not replace a symbolic-link database. Point DATABASE_URL at the real SQLite file."
    );
  }
  if (
    sourceBackupPath === activeDatabasePath ||
    safetyBackupPath === activeDatabasePath
  ) {
    throw new Error("Backup paths cannot be the active database path.");
  }

  const initialActiveState = captureDatabaseState(activeDatabasePath);
  const safetyBackup = activeDatabaseExisted
    ? createDatabaseBackup({
        databasePath: activeDatabasePath,
        outputPath: safetyBackupPath,
        repositoryRoot,
        now: options.now
      })
    : null;
  if (safetyBackup) {
    progress(`Safety backup created: ${safetyBackup.destinationPath}`);
  } else {
    progress("No active database existed; no safety backup was needed.");
  }

  const temporaryRestorePath = join(
    dirname(activeDatabasePath),
    `.${basename(activeDatabasePath)}.restore.${process.pid}.${randomUUID()}.db`
  );

  let replacementCompleted = false;
  try {
    const inspection = inspectBackupArtifact(sourceBackupPath, {
      rejectSymbolicLink: rejectBackupSymlink
    });
    if (
      options.expectedPayloadSha256 !== undefined &&
      inspection.manifest.payloadSha256 !==
        options.expectedPayloadSha256
    ) {
      throw new Error(
        "The scheduled backup changed after approval and was not restored."
      );
    }
    progress(
      `Validated backup container (format ${inspection.manifest.formatVersion}, schema ${inspection.manifest.schemaVersion}).`
    );
    extractBackupPayload(
      sourceBackupPath,
      temporaryRestorePath,
      inspection,
      { rejectSymbolicLink: rejectBackupSymlink }
    );
    const extractedMetadata = validateSqliteDatabase(temporaryRestorePath, {
      expectedManifest: inspection.manifest,
      requireCurrentSchema: false
    });
    progress(
      `Validated SQLite snapshot (${sumCounts(extractedMetadata.recordCounts)} records).`
    );

    runMigrations(temporaryRestorePath, repositoryRoot, {
      sourceBackupPath,
      expectedPayloadSha256: inspection.manifest.payloadSha256
    });
    const migratedMetadata = validateSqliteDatabase(temporaryRestorePath, {
      requireCurrentSchema: true
    });
    validateCurrentApplicationSchema(temporaryRestorePath, repositoryRoot);
    validateAppliedMigrations(
      migratedMetadata,
      repositoryRoot,
      temporaryRestorePath
    );
    progress(`Migrated restored copy to schema ${migratedMetadata.schemaVersion}.`);

    prepareRestoredDatabase(temporaryRestorePath);
    chmodSync(
      temporaryRestorePath,
      activeDatabaseExisted
        ? statSync(activeDatabasePath).mode & 0o777
        : 0o600
    );
    syncFile(temporaryRestorePath);

    if (activeDatabaseExisted) {
      await withExclusiveDatabaseLock(
        activeDatabasePath,
        () => {
          if (
            !sameDatabaseState(
              initialActiveState,
              captureDatabaseState(activeDatabasePath)
            )
          ) {
            throw activeDatabaseChangedError();
          }
        },
        () => {
          assertNoSqliteSidecars(activeDatabasePath);
          renameSync(temporaryRestorePath, activeDatabasePath);
          replacementCompleted = true;
          syncDirectory(dirname(activeDatabasePath));
        }
      );
    } else {
      if (
        !sameDatabaseState(
          initialActiveState,
          captureDatabaseState(activeDatabasePath)
        )
      ) {
        throw activeDatabaseChangedError();
      }
      linkSync(temporaryRestorePath, activeDatabasePath);
      replacementCompleted = true;
      removeTemporaryFile(temporaryRestorePath);
      syncDirectory(dirname(activeDatabasePath));
    }

    return {
      activeDatabasePath,
      sourceBackupPath,
      safetyBackupPath: safetyBackup?.destinationPath ?? null,
      restoredManifest: inspection.manifest,
      restoredRecordCounts: migratedMetadata.recordCounts,
      schemaVersion: migratedMetadata.schemaVersion
    };
  } catch (error) {
    const replacementMessage = replacementCompleted
      ? "The active database was replaced, but final durability confirmation failed. Stop Dayflow and recover from the reported safety backup if the database cannot be opened."
      : "Active database was not replaced.";
    const safetyMessage = safetyBackup
      ? `Safety backup: ${safetyBackup.destinationPath}`
      : "No prior active database existed, so no safety backup was created.";
    throw new Error(
      `${errorMessage(error)}\n${replacementMessage}\n${safetyMessage}`
    );
  } finally {
    removeTemporaryFile(temporaryRestorePath);
  }
}

export function formatRecordCounts(recordCounts: Record<string, number>) {
  return Object.entries(recordCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, count]) => `    ${table}: ${count}`)
    .join("\n");
}

function readDatabaseUrlFromEnv(repositoryRoot: string) {
  const envPath = join(repositoryRoot, ".env");
  if (!existsSync(envPath)) {
    throw new Error(
      "DATABASE_URL is not set and .env could not be found. Refusing to guess the active database."
    );
  }

  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) =>
      /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(candidate)
    );
  if (!line) {
    throw new Error(
      "DATABASE_URL is not set and is missing from .env. Refusing to guess the active database."
    );
  }

  const rawValue = line.slice(line.indexOf("=") + 1).trim();
  const unquoted =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue.replace(/\s+#.*$/, "").trim();
  if (!unquoted) {
    throw new Error("DATABASE_URL in .env is empty.");
  }
  return unquoted;
}

function createConsistentSnapshot(sourcePath: string, snapshotPath: string) {
  runSqlite(
    sourcePath,
    `VACUUM INTO ${sqlString(snapshotPath)};`,
    true,
    "create a consistent SQLite snapshot"
  );
}

function validateSqliteDatabase(
  databasePath: string,
  options: {
    expectedManifest?: BackupManifest;
    requireCurrentSchema: boolean;
  }
): DatabaseMetadata {
  assertExistingRegularFile(databasePath, "SQLite snapshot");

  const integrityResult = runSqlite(
    databasePath,
    "PRAGMA integrity_check;",
    true,
    "run SQLite integrity_check"
  ).trim();
  if (integrityResult !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${integrityResult}`);
  }

  const tableNames = databaseTableNames(databasePath);
  validateRecognizedDayflowSchema(databasePath, tableNames);

  if (options.requireCurrentSchema) {
    for (const [tableName, requiredColumns] of Object.entries(
      CURRENT_TABLE_COLUMNS
    )) {
      if (!tableNames.includes(tableName)) {
        throw new Error(
          `Restored database is missing current table ${tableName}.`
        );
      }
      const columns = tableColumns(databasePath, tableName);
      for (const column of requiredColumns) {
        if (!columns.includes(column)) {
          throw new Error(
            `Restored database is missing current column ${tableName}.${column}.`
          );
        }
      }
    }
  }

  const foreignKeyFailures = queryJson<Record<string, unknown>>(
    databasePath,
    "PRAGMA foreign_key_check;"
  );
  if (foreignKeyFailures.length > 0) {
    const first = foreignKeyFailures[0];
    throw new Error(
      `Foreign-key validation failed for ${foreignKeyFailures.length} relationship(s), beginning with table ${String(first.table ?? "unknown")}.`
    );
  }

  validateSemanticRelationships(databasePath, tableNames);

  const recordCounts: Record<string, number> = {};
  for (const tableName of tableNames) {
    const rows = queryJson<{ count: number }>(
      databasePath,
      `SELECT COUNT(*) AS count FROM ${sqlIdentifier(tableName)};`
    );
    const count = Number(rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Could not count records in table ${tableName}.`);
    }
    recordCounts[tableName] = count;
  }

  const schemaMigrations = tableNames.includes("_prisma_migrations")
    ? queryJson<{ migration_name: string }>(
        databasePath,
        `SELECT migration_name
           FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL
            AND rolled_back_at IS NULL
          ORDER BY migration_name;`
      ).map((row) => row.migration_name)
    : [];
  const schemaVersion =
    schemaMigrations.at(-1) ?? "legacy-unversioned";
  const schemaHash = createHash("sha256")
    .update(
      JSON.stringify(
        queryJson<{
          type: string;
          name: string;
          tbl_name: string;
          sql: string | null;
        }>(
          databasePath,
          `SELECT type, name, tbl_name, sql
             FROM sqlite_schema
            WHERE name NOT LIKE 'sqlite_%'
            ORDER BY type, name;`
        )
      )
    )
    .digest("hex");

  if (options.expectedManifest) {
    compareManifestToSnapshot(options.expectedManifest, {
      tableNames,
      recordCounts,
      schemaMigrations,
      schemaVersion,
      schemaHash
    });
  }

  return {
    tableNames,
    recordCounts,
    schemaMigrations,
    schemaVersion,
    schemaHash
  };
}

function databaseTableNames(databasePath: string) {
  return queryJson<{ name: string }>(
    databasePath,
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name;`
  ).map((row) => row.name);
}

function validateRecognizedDayflowSchema(
  databasePath: string,
  tableNames: string[]
) {
  const unknownTable = tableNames.find(
    (tableName) => !(tableName in CURRENT_TABLE_COLUMNS)
  );
  if (unknownTable) {
    throw new Error(
      `The snapshot has an unsupported Dayflow schema: unexpected table ${unknownTable}.`
    );
  }

  for (const [tableName, requiredColumns] of Object.entries(
    OLDEST_SUPPORTED_DAYFLOW_COLUMNS
  )) {
    if (!tableNames.includes(tableName)) {
      throw new Error(
        `The snapshot is not a recognized Dayflow database: missing table ${tableName}.`
      );
    }
    const columns = tableColumns(databasePath, tableName);
    const missingColumn = requiredColumns.find(
      (column) => !columns.includes(column)
    );
    if (missingColumn) {
      throw new Error(
        `The snapshot is not a recognized Dayflow database: missing column ${tableName}.${missingColumn}.`
      );
    }
  }

  for (const tableName of tableNames) {
    const supportedColumns = CURRENT_TABLE_COLUMNS[tableName];
    const columnInfo = tableColumnInfo(databasePath, tableName);
    const hiddenColumn = columnInfo.find(
      (column) => column.hidden !== 0
    );
    if (hiddenColumn) {
      throw new Error(
        `The snapshot has an unsupported Dayflow schema: unexpected column ${tableName}.${hiddenColumn.name} (generated or hidden columns are not supported).`
      );
    }
    const unexpectedColumn = columnInfo
      .map((column) => column.name)
      .find((column) => !supportedColumns.includes(column));
    if (unexpectedColumn) {
      throw new Error(
        `The snapshot has an unsupported Dayflow schema: unexpected column ${tableName}.${unexpectedColumn}.`
      );
    }
  }
}

function validateSemanticRelationships(
  databasePath: string,
  tableNames: string[]
) {
  const hasTable = (tableName: string) => tableNames.includes(tableName);
  const hasColumns = (tableName: string, columns: string[]) =>
    hasTable(tableName) &&
    columns.every((column) => tableColumns(databasePath, tableName).includes(column));

  const directRelationships = [
    ["ProjectPhase", "projectId", "Project"],
    ["Task", "projectId", "Project"],
    ["Task", "phaseId", "ProjectPhase"],
    ["Note", "taskId", "Task"],
    ["Note", "projectId", "Project"],
    ["Material", "taskId", "Task"],
    ["Material", "noteId", "Note"],
    ["Material", "projectId", "Project"],
    ["TimeBlock", "taskId", "Task"],
    ["ActivityEntry", "taskId", "Task"],
    ["ActivityEntry", "projectId", "Project"],
    ["ActivityEntry", "attributedProjectId", "Project"],
    ["ActivityEntry", "focusSessionId", "FocusSession"],
    ["FocusSession", "taskId", "Task"],
    ["FocusSession", "projectId", "Project"],
    ["TaskScheduleChange", "taskId", "Task"]
  ] as const;
  for (const [
    sourceTable,
    sourceColumn,
    targetTable
  ] of directRelationships) {
    if (
      hasColumns(sourceTable, [sourceColumn]) &&
      hasColumns(targetTable, ["id"])
    ) {
      assertZeroCount(
        databasePath,
        `${sourceTable}.${sourceColumn} relationship`,
        `SELECT COUNT(*) AS count
           FROM ${sqlIdentifier(sourceTable)} AS source
           LEFT JOIN ${sqlIdentifier(targetTable)} AS target
             ON target.id = source.${sqlIdentifier(sourceColumn)}
          WHERE source.${sqlIdentifier(sourceColumn)} IS NOT NULL
            AND target.id IS NULL;`
      );
    }
  }

  if (
    hasColumns("Task", ["id", "projectId", "phaseId"]) &&
    hasColumns("ProjectPhase", ["id", "projectId"])
  ) {
    assertZeroCount(
      databasePath,
      "Task/Phase attribution",
      `SELECT COUNT(*) AS count
         FROM "Task" AS task
         LEFT JOIN "ProjectPhase" AS phase ON phase.id = task.phaseId
        WHERE task.phaseId IS NOT NULL
          AND (
            phase.id IS NULL
            OR task.projectId IS NULL
            OR task.projectId <> phase.projectId
          );`
    );
  }

  if (
    hasColumns("ActivityEntry", [
      "taskId",
      "projectId",
      "attributedProjectId"
    ]) &&
    hasColumns("Task", ["id", "projectId"])
  ) {
    assertZeroCount(
      databasePath,
      "Activity Project attribution",
      `SELECT COUNT(*) AS count
         FROM "ActivityEntry" AS activity
         LEFT JOIN "Task" AS task ON task.id = activity.taskId
        WHERE (
          activity.taskId IS NULL
          AND activity.attributedProjectId IS NOT activity.projectId
        ) OR (
          activity.taskId IS NOT NULL
          AND (
            task.id IS NULL
            OR (
              task.projectId IS NOT NULL
              AND (
                activity.projectId IS NOT NULL
                OR activity.attributedProjectId IS NOT task.projectId
              )
            )
            OR (
              task.projectId IS NULL
              AND activity.attributedProjectId IS NOT activity.projectId
            )
          )
        );`
    );
  }

  for (const tableName of ["Note", "Material"] as const) {
    if (
      hasColumns(tableName, ["taskId", "projectId"]) &&
      hasColumns("Task", ["id", "projectId"])
    ) {
      assertZeroCount(
        databasePath,
        `${tableName}/Task Project attribution`,
        `SELECT COUNT(*) AS count
           FROM ${sqlIdentifier(tableName)} AS evidence
           JOIN "Task" AS task ON task.id = evidence.taskId
          WHERE task.projectId IS NOT NULL
            AND evidence.projectId IS NOT NULL;`
      );
    }
  }

  if (
    hasColumns("FocusSession", ["taskId", "projectId"]) &&
    hasColumns("Task", ["id", "projectId"])
  ) {
    assertZeroCount(
      databasePath,
      "Focus Session Project attribution",
      `SELECT COUNT(*) AS count
         FROM "FocusSession" AS session
         JOIN "Task" AS task ON task.id = session.taskId
        WHERE task.projectId IS NOT NULL
          AND session.projectId IS NOT NULL;`
    );
  }

  if (
    hasColumns("ActivityEntry", [
      "origin",
      "taskId",
      "focusSessionId"
    ]) &&
    hasColumns("FocusSession", ["id", "taskId"])
  ) {
    assertZeroCount(
      databasePath,
      "Focus Session Activity link",
      `SELECT COUNT(*) AS count
         FROM "ActivityEntry" AS activity
         JOIN "FocusSession" AS session
           ON session.id = activity.focusSessionId
        WHERE activity.origin <> 'FOCUS'
           OR activity.taskId IS NOT session.taskId;`
    );
  }

  if (
    hasColumns("ActivityEntry", ["focusSessionId"]) &&
    hasColumns("FocusSession", [
      "id",
      "kind",
      "status",
      "actualMinutes"
    ])
  ) {
    assertZeroCount(
      databasePath,
      "completed Focus Session evidence",
      `SELECT COUNT(*) AS count
         FROM "FocusSession" AS session
        WHERE session.kind = 'FOCUS'
          AND session.status = 'COMPLETED'
          AND session.actualMinutes >= 1
          AND NOT EXISTS (
            SELECT 1
              FROM "ActivityEntry" AS activity
             WHERE activity.focusSessionId = session.id
          );`
    );
  }
}

function assertZeroCount(
  databasePath: string,
  relationshipName: string,
  sql: string
) {
  const rows = queryJson<{ count: number }>(databasePath, sql);
  const count = Number(rows[0]?.count);
  if (count !== 0) {
    throw new Error(
      `${relationshipName} validation failed for ${count} record(s).`
    );
  }
}

function tableColumns(databasePath: string, tableName: string) {
  return tableColumnInfo(databasePath, tableName).map(
    (column) => column.name
  );
}

function tableColumnInfo(databasePath: string, tableName: string) {
  return queryJson<{ name: string; hidden: number }>(
    databasePath,
    `SELECT name, hidden
       FROM pragma_table_xinfo(${sqlString(tableName)})
      ORDER BY cid;`
  );
}

function compareManifestToSnapshot(
  manifest: BackupManifest,
  metadata: DatabaseMetadata
) {
  const expectedTables = Object.keys(manifest.recordCounts).sort();
  const actualTables = [...metadata.tableNames].sort();
  if (JSON.stringify(expectedTables) !== JSON.stringify(actualTables)) {
    throw new Error(
      "Backup table inventory does not match its manifest; the archive is incomplete or altered."
    );
  }

  for (const tableName of actualTables) {
    if (manifest.recordCounts[tableName] !== metadata.recordCounts[tableName]) {
      throw new Error(
        `Backup record count mismatch for ${tableName}: expected ${manifest.recordCounts[tableName]}, found ${metadata.recordCounts[tableName]}.`
      );
    }
  }

  if (manifest.schemaHash !== metadata.schemaHash) {
    throw new Error(
      "Backup schema does not match its manifest; the archive is altered."
    );
  }
  if (
    JSON.stringify(manifest.schemaMigrations) !==
    JSON.stringify(metadata.schemaMigrations)
  ) {
    throw new Error(
      "Backup migration history does not match its manifest; the archive is altered."
    );
  }
  if (manifest.schemaVersion !== metadata.schemaVersion) {
    throw new Error(
      "Backup schema version does not match its migration history."
    );
  }
}

function writeArtifact(
  artifactPath: string,
  snapshotPath: string,
  manifest: BackupManifest
) {
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf8");
  if (manifestBuffer.length > MAX_MANIFEST_BYTES) {
    throw new Error("Backup manifest is unexpectedly large.");
  }
  const manifestLength = Buffer.alloc(MANIFEST_LENGTH_BYTES);
  manifestLength.writeUInt32BE(manifestBuffer.length);

  const input = openSync(snapshotPath, "r");
  const output = openSync(artifactPath, "wx", 0o600);
  try {
    writeAll(output, BACKUP_MAGIC);
    writeAll(output, manifestLength);
    writeAll(output, manifestBuffer);
    copyFileDescriptor(input, output, manifest.payloadBytes);
    fsyncSync(output);
  } finally {
    closeSync(input);
    closeSync(output);
  }
}

function inspectBackupArtifact(
  backupPath: string,
  options: { rejectSymbolicLink?: boolean } = {}
): ArtifactInspection {
  assertExistingRegularFile(backupPath, "backup artifact");
  const input = openBackupForRead(
    backupPath,
    Boolean(options.rejectSymbolicLink)
  );
  try {
    return inspectBackupFileDescriptor(input, fstatSync(input).size);
  } finally {
    closeSync(input);
  }
}

function inspectBackupFileDescriptor(
  input: number,
  fileSize: number
): ArtifactInspection {
  const header = readExactly(
    input,
    BACKUP_MAGIC.length + MANIFEST_LENGTH_BYTES,
    0
  );
  if (
    !header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)
  ) {
    throw new Error(
      "This is not a Dayflow backup artifact (invalid file header)."
    );
  }

  const manifestLength = header.readUInt32BE(BACKUP_MAGIC.length);
  if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) {
    throw new Error("Backup manifest length is invalid.");
  }
  const manifestBuffer = readExactly(
    input,
    manifestLength,
    BACKUP_MAGIC.length + MANIFEST_LENGTH_BYTES
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw new Error("Backup manifest is not valid JSON.");
  }
  const manifest = parseManifest(parsed);
  const payloadOffset =
    BACKUP_MAGIC.length + MANIFEST_LENGTH_BYTES + manifestLength;
  const expectedSize = payloadOffset + manifest.payloadBytes;
  if (fileSize !== expectedSize) {
    throw new Error(
      `Backup is truncated or has trailing data: expected ${expectedSize} bytes, found ${fileSize}.`
    );
  }

  const actualHash = hashFileDescriptor(
    input,
    payloadOffset,
    manifest.payloadBytes
  );
  if (actualHash !== manifest.payloadSha256) {
    throw new Error(
      "Backup payload checksum does not match its manifest; the archive is corrupt or altered."
    );
  }
  return { manifest, payloadOffset, sizeBytes: fileSize };
}

function parseManifest(value: unknown): BackupManifest {
  if (!isObject(value)) {
    throw new Error("Backup manifest must be a JSON object.");
  }
  if (value.format !== BACKUP_FORMAT) {
    throw new Error("Backup format is not recognized by this Dayflow release.");
  }
  if (
    !Number.isInteger(value.formatVersion) ||
    Number(value.formatVersion) > BACKUP_FORMAT_VERSION
  ) {
    throw new Error(
      `Backup format version ${String(value.formatVersion)} is newer than the supported version ${BACKUP_FORMAT_VERSION}.`
    );
  }
  if (value.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup format version ${String(value.formatVersion)} is not supported by this Dayflow release.`
    );
  }
  if (
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Backup manifest has an invalid creation timestamp.");
  }
  if (
    typeof value.applicationVersion !== "string" ||
    !value.applicationVersion
  ) {
    throw new Error("Backup manifest has an invalid application version.");
  }
  if (typeof value.schemaVersion !== "string" || !value.schemaVersion) {
    throw new Error("Backup manifest has an invalid schema version.");
  }
  if (
    !Array.isArray(value.schemaMigrations) ||
    !value.schemaMigrations.every(
      (migration) => typeof migration === "string" && migration.length > 0
    )
  ) {
    throw new Error("Backup manifest has invalid migration history.");
  }
  if (
    typeof value.schemaHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.schemaHash)
  ) {
    throw new Error("Backup manifest has an invalid schema checksum.");
  }
  if (!isObject(value.recordCounts)) {
    throw new Error("Backup manifest has invalid record counts.");
  }
  const recordCounts: Record<string, number> = {};
  for (const [tableName, count] of Object.entries(value.recordCounts)) {
    if (
      !tableName ||
      !Number.isSafeInteger(count) ||
      Number(count) < 0
    ) {
      throw new Error("Backup manifest has invalid record counts.");
    }
    recordCounts[tableName] = Number(count);
  }
  if (Object.keys(recordCounts).length === 0) {
    throw new Error("Backup manifest does not list any database tables.");
  }
  if (
    !Number.isSafeInteger(value.payloadBytes) ||
    Number(value.payloadBytes) <= 0
  ) {
    throw new Error("Backup manifest has an invalid payload size.");
  }
  if (
    typeof value.payloadSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.payloadSha256)
  ) {
    throw new Error("Backup manifest has an invalid payload checksum.");
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: Number(value.formatVersion),
    createdAt: value.createdAt,
    applicationVersion: value.applicationVersion,
    schemaVersion: value.schemaVersion,
    schemaMigrations: [...value.schemaMigrations],
    schemaHash: value.schemaHash,
    recordCounts,
    payloadBytes: Number(value.payloadBytes),
    payloadSha256: value.payloadSha256
  };
}

function extractBackupPayload(
  backupPath: string,
  outputPath: string,
  inspection: ArtifactInspection,
  options: { rejectSymbolicLink?: boolean } = {}
) {
  const input = openBackupForRead(
    backupPath,
    Boolean(options.rejectSymbolicLink)
  );
  const output = openSync(outputPath, "wx", 0o600);
  const payloadHash = createHash("sha256");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let remaining = inspection.manifest.payloadBytes;
    let inputPosition = inspection.payloadOffset;
    while (remaining > 0) {
      const requested = Math.min(buffer.length, remaining);
      const bytesRead = readSync(
        input,
        buffer,
        0,
        requested,
        inputPosition
      );
      if (bytesRead === 0) {
        throw new Error("Backup payload ended before the declared size.");
      }
      const chunk = buffer.subarray(0, bytesRead);
      writeAll(output, chunk);
      payloadHash.update(chunk);
      remaining -= bytesRead;
      inputPosition += bytesRead;
    }
    fsyncSync(output);
    if (payloadHash.digest("hex") !== inspection.manifest.payloadSha256) {
      throw new Error(
        "Extracted backup checksum does not match the inspected artifact; the source changed during restore."
      );
    }
  } finally {
    closeSync(input);
    closeSync(output);
  }
}

function runMigrations(
  databasePath: string,
  repositoryRoot: string,
  proof: {
    sourceBackupPath: string;
    expectedPayloadSha256: string;
  }
) {
  const migrationScript = join(
    repositoryRoot,
    "scripts",
    "migrate-database.ts"
  );
  if (!existsSync(migrationScript)) {
    throw new Error(`Migration helper not found: ${migrationScript}`);
  }
  try {
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        migrationScript,
        "--disposable-restore-copy",
        databasePath,
        "--source-backup",
        proof.sourceBackupPath,
        "--expected-payload-sha256",
        proof.expectedPayloadSha256
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrlForPath(databasePath)
        },
        stdio: "inherit"
      }
    );
  } catch (error) {
    throw new Error(`Migration of the restored copy failed: ${errorMessage(error)}`);
  }
}

function validateAppliedMigrations(
  metadata: DatabaseMetadata,
  repositoryRoot: string,
  databasePath: string
) {
  const migrationsDirectory = join(repositoryRoot, "prisma", "migrations");
  const expectedMigrations = readdirSync(migrationsDirectory, {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const missing = expectedMigrations.filter(
    (migration) => !metadata.schemaMigrations.includes(migration)
  );
  const unsupported = metadata.schemaMigrations.filter(
    (migration) => !expectedMigrations.includes(migration)
  );
  if (missing.length > 0 || unsupported.length > 0) {
    const details = [
      missing.length > 0
        ? `missing migration(s): ${missing.join(", ")}`
        : "",
      unsupported.length > 0
        ? `unsupported future migration(s): ${unsupported.join(", ")}`
        : ""
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Restored database migration history is not supported by this Dayflow release (${details}).`
    );
  }

  const appliedChecksums = new Map(
    queryJson<{ migration_name: string; checksum: string }>(
      databasePath,
      `SELECT migration_name, checksum
         FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        ORDER BY migration_name;`
    ).map((migration) => [migration.migration_name, migration.checksum])
  );
  for (const migration of expectedMigrations) {
    const migrationPath = join(
      migrationsDirectory,
      migration,
      "migration.sql"
    );
    const expectedChecksum = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");
    if (appliedChecksums.get(migration) !== expectedChecksum) {
      throw new Error(
        `Restored database migration checksum does not match ${migration}.`
      );
    }
  }
}

function validateCurrentApplicationSchema(
  databasePath: string,
  repositoryRoot: string
) {
  const initPath = join(repositoryRoot, "prisma", "init.sql");
  if (!existsSync(initPath)) {
    throw new Error(`Current schema reference not found: ${initPath}`);
  }
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-schema-reference-")
  );
  const referenceDatabase = join(temporaryDirectory, "reference.db");
  try {
    runSqlite(
      referenceDatabase,
      readFileSync(initPath, "utf8"),
      false,
      "create the current schema reference"
    );
    const difference = findApplicationSchemaDifference(
      referenceDatabase,
      databasePath
    );
    if (difference) {
      throw new Error(
        `Restored database schema does not exactly match this Dayflow release (first difference: ${difference.tableName} ${difference.differingParts.join("/") || "table inventory"}).`
      );
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function describeApplicationSchema(databasePath: string) {
  const tables = queryJson<{ name: string }>(
    databasePath,
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
      ORDER BY name;`
  ).map((row) => row.name);

  return tables.map((tableName) => {
    const columns = queryJson<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
      hidden: number;
    }>(
      databasePath,
      `SELECT name, type, "notnull", dflt_value, pk, hidden
         FROM pragma_table_xinfo(${sqlString(tableName)})
        ORDER BY name;`
    );
    const foreignKeys = queryJson<{
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>(
      databasePath,
      `SELECT "table", "from", "to", on_update, on_delete, "match"
         FROM pragma_foreign_key_list(${sqlString(tableName)})
        ORDER BY "table", "from", "to";`
    );
    const indexes = queryJson<{
      name: string;
      unique: number;
      partial: number;
    }>(
      databasePath,
      `SELECT name, "unique", partial
         FROM pragma_index_list(${sqlString(tableName)})
        WHERE name NOT LIKE 'sqlite_autoindex_%'
        ORDER BY name;`
    )
      .map((index) => ({
        unique: index.unique,
        partial: index.partial,
        columns: queryJson<{ seqno: number; name: string }>(
          databasePath,
          `SELECT seqno, name
             FROM pragma_index_info(${sqlString(index.name)})
            ORDER BY seqno;`
        )
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
    return { tableName, columns, foreignKeys, indexes };
  });
}

export function findApplicationSchemaDifference(
  expectedDatabasePath: string,
  actualDatabasePath: string
): ApplicationSchemaDifference | null {
  const expected = describeApplicationSchema(expectedDatabasePath);
  const actual = describeApplicationSchema(actualDatabasePath);
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return null;
  }

  const tableName =
    [...new Set([
      ...expected.map((entry) => entry.tableName),
      ...actual.map((entry) => entry.tableName)
    ])].find((candidate) => {
      const expectedEntry = expected.find(
        (entry) => entry.tableName === candidate
      );
      const actualEntry = actual.find(
        (entry) => entry.tableName === candidate
      );
      return (
        JSON.stringify(expectedEntry) !==
        JSON.stringify(actualEntry)
      );
    }) ?? "unknown";
  const expectedEntry = expected.find(
    (entry) => entry.tableName === tableName
  );
  const actualEntry = actual.find(
    (entry) => entry.tableName === tableName
  );
  const differingParts = (
    ["columns", "foreignKeys", "indexes"] as const
  ).filter(
    (part) =>
      JSON.stringify(expectedEntry?.[part]) !==
      JSON.stringify(actualEntry?.[part])
  );
  return { tableName, differingParts };
}

function assertNoSqliteSidecars(databasePath: string) {
  const sidecars = [`${databasePath}-wal`, `${databasePath}-shm`].filter(
    existsSync
  );
  if (sidecars.length > 0) {
    throw new Error(
      `SQLite sidecar files are still active (${sidecars.map((path) => basename(path)).join(", ")}). Stop Dayflow and retry.`
    );
  }
}

function activeDatabaseChangedError() {
  return new Error(
    "The active database changed while restore was running. Stop Dayflow and retry."
  );
}

async function withExclusiveDatabaseLock(
  databasePath: string,
  beforePrepare: () => void,
  operation: () => void
) {
  const markerId = randomUUID();
  const observedMarker = `DAYFLOW_RESTORE_OBSERVED_${markerId}=`;
  const lockedMarker = `DAYFLOW_RESTORE_LOCKED_${markerId}=`;
  const child = spawn(
    "sqlite3",
    ["-batch", "-bail", "--", databasePath],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.on("error", () => undefined);

  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });

  const waitForMarker = (
    marker: string,
    timeoutMessage: string
  ) =>
    new Promise<number>((resolveMarker, rejectMarker) => {
      let settled = false;
      const finish = (error?: unknown, value?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout.off("data", checkOutput);
        child.off("error", onError);
        child.off("close", onClose);
        if (error) rejectMarker(error);
        else resolveMarker(value ?? 0);
      };
      const checkOutput = () => {
        const line = stdout
          .split(/\r?\n/)
          .find((candidate) => candidate.startsWith(marker));
        if (!line) return;
        const value = Number(line.slice(marker.length));
        if (!Number.isSafeInteger(value)) {
          finish(new Error("SQLite returned an invalid data version."));
          return;
        }
        finish(undefined, value);
      };
      const onError = (error: Error) => finish(error);
      const onClose = (code: number | null) =>
        finish(
          new Error(
            `sqlite3 exited before restore locking completed (code ${String(code)}): ${stderr.trim() || "no details"}`
          )
        );
      const timeout = setTimeout(
        () => finish(new Error(timeoutMessage)),
        10_000
      );
      child.stdout.on("data", checkOutput);
      child.once("error", onError);
      child.once("close", onClose);
      checkOutput();
    });

  let lockAcquired = false;
  try {
    const observedVersionPromise = waitForMarker(
      observedMarker,
      "Timed out observing the active database before restore."
    );
    child.stdin.write(
      `SELECT '${observedMarker}' || data_version FROM pragma_data_version;\n`
    );
    const observedVersion = await observedVersionPromise;
    beforePrepare();
    const lockedVersionPromise = waitForMarker(
      lockedMarker,
      "Timed out obtaining exclusive access to the active database. Stop Dayflow and retry."
    );
    child.stdin.write(
      `PRAGMA busy_timeout = 5000;
       PRAGMA wal_checkpoint(TRUNCATE);
       PRAGMA journal_mode = DELETE;
       BEGIN EXCLUSIVE;
       SELECT '${lockedMarker}' || data_version FROM pragma_data_version;\n`
    );
    const lockedVersion = await lockedVersionPromise;
    lockAcquired = true;
    if (lockedVersion !== observedVersion) {
      throw activeDatabaseChangedError();
    }
  } catch (error) {
    if (lockAcquired) {
      child.stdin.end("ROLLBACK;\n");
    } else {
      child.kill();
    }
    await closed;
    throw new Error(
      `Could not obtain exclusive access to the active database: ${errorMessage(error)}`
    );
  }

  let operationError: unknown;
  try {
    operation();
  } catch (error) {
    operationError = error;
  }

  child.stdin.end(operationError ? "ROLLBACK;\n" : "COMMIT;\n");
  const result = await closed;
  if (operationError) throw operationError;
  if (result.code !== 0) {
    throw new Error(
      `SQLite could not release the restore lock cleanly (code ${String(result.code)}): ${stderr.trim() || "no details"}`
    );
  }
}

function prepareRestoredDatabase(databasePath: string) {
  runSqlite(
    databasePath,
    `PRAGMA wal_checkpoint(TRUNCATE);
     PRAGMA journal_mode = DELETE;`,
    false,
    "prepare the restored database for replacement"
  );
}

function captureDatabaseState(databasePath: string) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map(
    captureFileState
  );
}

function captureFileState(path: string): FileState {
  if (!existsSync(path)) return { path, exists: false };
  const stats = statSync(path);
  return {
    path,
    exists: true,
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedMs: stats.mtimeMs
  };
}

function sameDatabaseState(left: FileState[], right: FileState[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function queryJson<T>(databasePath: string, sql: string): T[] {
  const output = runSqlite(
    databasePath,
    sql,
    true,
    "query SQLite backup metadata",
    true
  ).trim();
  if (!output) return [];
  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed as T[];
  } catch {
    throw new Error("SQLite returned malformed JSON while validating backup data.");
  }
}

function runSqlite(
  databasePath: string,
  sql: string,
  readOnly: boolean,
  action: string,
  json = false
) {
  const args = [
    ...(readOnly ? ["-readonly"] : []),
    "-batch",
    "-bail",
    ...(json ? ["-json"] : []),
    "--",
    databasePath,
    sql
  ];
  try {
    return execFileSync("sqlite3", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`Could not ${action}: ${errorMessage(error)}`);
  }
}

function hashFile(path: string) {
  const input = openSync(path, "r");
  try {
    const bytes = statSync(path).size;
    return {
      bytes,
      sha256: hashFileDescriptor(input, 0, bytes)
    };
  } finally {
    closeSync(input);
  }
}

function hashFileDescriptor(
  fileDescriptor: number,
  offset: number,
  length: number
) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let remaining = length;
  let position = offset;
  while (remaining > 0) {
    const requested = Math.min(buffer.length, remaining);
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      0,
      requested,
      position
    );
    if (bytesRead === 0) {
      throw new Error("Unexpected end of file while calculating checksum.");
    }
    hash.update(buffer.subarray(0, bytesRead));
    remaining -= bytesRead;
    position += bytesRead;
  }
  return hash.digest("hex");
}

function copyFileDescriptor(
  input: number,
  output: number,
  expectedBytes: number
) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let copied = 0;
  while (copied < expectedBytes) {
    const bytesRead = readSync(
      input,
      buffer,
      0,
      Math.min(buffer.length, expectedBytes - copied),
      copied
    );
    if (bytesRead === 0) {
      throw new Error("SQLite snapshot ended unexpectedly.");
    }
    writeAll(output, buffer.subarray(0, bytesRead));
    copied += bytesRead;
  }
}

function readExactly(fileDescriptor: number, length: number, position: number) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      offset,
      length - offset,
      position + offset
    );
    if (bytesRead === 0) {
      throw new Error("Backup ended before its header was complete.");
    }
    offset += bytesRead;
  }
  return buffer;
}

function writeAll(fileDescriptor: number, buffer: Buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.length - offset
    );
  }
}

function syncFile(path: string) {
  const fileDescriptor = openSync(path, "r");
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}

function syncDirectory(path: string) {
  const fileDescriptor = openSync(path, "r");
  try {
    fsyncSync(fileDescriptor);
  } catch (error) {
    const code = isObject(error) ? error.code : undefined;
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(String(code))) throw error;
  } finally {
    closeSync(fileDescriptor);
  }
}

function assertExistingRegularFile(path: string, label: string) {
  if (!existsSync(path)) {
    throw new Error(`The ${label} does not exist: ${path}`);
  }
  if (!lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()) {
    throw new Error(`The ${label} is not a regular file: ${path}`);
  }
}

function openBackupForRead(path: string, rejectSymbolicLink: boolean) {
  try {
    return openSync(
      path,
      rejectSymbolicLink
        ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
        : "r"
    );
  } catch (error) {
    const code = isObject(error) ? error.code : undefined;
    if (rejectSymbolicLink && code === "ELOOP") {
      throw new Error(
        "The scheduled backup is a symbolic link and was not restored."
      );
    }
    throw error;
  }
}

function removeTemporaryFile(path: string) {
  if (existsSync(path)) rmSync(path, { force: true });
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseUrlForPath(path: string) {
  return `file:${encodeURI(path)
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")}`;
}

function readApplicationVersion(repositoryRoot: string) {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8")
  ) as { version?: unknown };
  return typeof packageJson.version === "string"
    ? packageJson.version
    : "unknown";
}

function timestampForFile(date: Date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "")
    .replaceAll("-", "");
}

function sumCounts(recordCounts: Record<string, number>) {
  return Object.values(recordCounts).reduce((sum, count) => sum + count, 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const detail =
      isObject(error) && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    return detail || error.message;
  }
  return String(error);
}
