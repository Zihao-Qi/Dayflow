import {
  createDatabaseBackup,
  formatRecordCounts,
  resolveActiveDatabase
} from "../src/modules/data-ops/services/sqlite-backup-engine";
import { systemClock } from "../src/shared/kernel/calendar";

try {
  // Sample once at entry: the engine takes the instant, it does not read a clock.
  const now = systemClock.now();
  const options = parseArguments(process.argv.slice(2));
  const { databasePath } = resolveActiveDatabase();
  const result = createDatabaseBackup({
    databasePath,
    outputPath: options.outputPath,
    now
  });

  console.log("Dayflow backup complete.");
  console.log(`  Active database: ${result.sourcePath}`);
  console.log(`  Backup: ${result.destinationPath}`);
  console.log(`  Created: ${result.manifest.createdAt}`);
  console.log(`  Format version: ${result.manifest.formatVersion}`);
  console.log(`  Schema version: ${result.manifest.schemaVersion}`);
  console.log("  Record counts:");
  console.log(formatRecordCounts(result.manifest.recordCounts));
} catch (error) {
  console.error(
    `Dayflow backup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}

function parseArguments(args: string[]) {
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      outputPath = args[index + 1];
      if (!outputPath) throw new Error("--output requires a file path.");
      index += 1;
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: npm run db:backup -- [--output <file.dayflow-backup>]"
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { outputPath };
}
