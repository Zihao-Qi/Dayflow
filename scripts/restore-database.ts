import {
  formatRecordCounts,
  resolveActiveDatabase,
  restoreDatabaseBackup
} from "../src/modules/data-ops/services/sqlite-backup-engine";

void main();

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options.confirmReplace) {
      throw new Error(
        "Restore replaces the active dataset. Re-run with --confirm-replace after stopping Dayflow."
      );
    }

    const { databasePath } = resolveActiveDatabase();
    console.log(`Active database: ${databasePath}`);
    console.log(`Restore source: ${options.backupPath}`);
    const result = await restoreDatabaseBackup({
      databasePath,
      backupPath: options.backupPath,
      safetyBackupPath: options.safetyBackupPath,
      onProgress: (message) => console.log(message)
    });

    console.log("Dayflow restore complete.");
    console.log(`  Active database: ${result.activeDatabasePath}`);
    console.log(
      result.safetyBackupPath
        ? `  Safety backup: ${result.safetyBackupPath}`
        : "  Safety backup: not needed (no prior active database)"
    );
    console.log(`  Restored from: ${result.sourceBackupPath}`);
    console.log(`  Schema version: ${result.schemaVersion}`);
    console.log("  Record counts after migration:");
    console.log(formatRecordCounts(result.restoredRecordCounts));
  } catch (error) {
    console.error(
      `Dayflow restore failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

function parseArguments(args: string[]) {
  let backupPath: string | undefined;
  let safetyBackupPath: string | undefined;
  let confirmReplace = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--from") {
      backupPath = args[index + 1];
      if (!backupPath) throw new Error("--from requires a backup file path.");
      index += 1;
      continue;
    }
    if (argument === "--safety-output") {
      safetyBackupPath = args[index + 1];
      if (!safetyBackupPath) {
        throw new Error("--safety-output requires a backup file path.");
      }
      index += 1;
      continue;
    }
    if (argument === "--confirm-replace") {
      confirmReplace = true;
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: npm run db:restore -- --from <file.dayflow-backup> --confirm-replace [--safety-output <file.dayflow-backup>]"
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!backupPath) throw new Error("--from is required.");
  return { backupPath, safetyBackupPath, confirmReplace };
}
