import {
  DatabaseMigrationError,
  migrateActiveDatabase,
  migrateDisposableRestoreCopy
} from "../src/modules/data-ops/services/sqlite-migration-engine";
import { systemClock } from "../src/shared/kernel/calendar";

try {
  const args = process.argv.slice(2);
  // Sample once at entry: the engine takes the instant, it does not read a clock.
  const options = {
    onProgress: (message: string) => console.log(message),
    now: systemClock.now()
  };
  if (args.length === 0) {
    migrateActiveDatabase(options);
  } else if (
    args.length === 6 &&
    args[0] === "--disposable-restore-copy" &&
    args[2] === "--source-backup" &&
    args[4] === "--expected-payload-sha256"
  ) {
    migrateDisposableRestoreCopy(args[1], {
      ...options,
      sourceBackupPath: args[3],
      expectedPayloadSha256: args[5]
    });
  } else {
    throw new Error(
      "The migration helper received invalid arguments."
    );
  }
} catch (error) {
  if (error instanceof DatabaseMigrationError) {
    console.error(`Dayflow migration failed: ${error.message}`);
    if (
      error.facts.safety?.kind === "verified-backup"
    ) {
      console.error(
        `Safety backup retained: ${error.facts.safety.backup.destinationPath}`
      );
      console.error(
        `Recover explicitly with: npm run db:restore -- --from ${shellQuote(
          error.facts.safety.backup.destinationPath
        )} --confirm-replace`
      );
    }
    if (error.facts.targetMayHaveChanged) {
      console.error(
        error.facts.target === "active-database"
          ? "The database may be partially changed; no automatic rollback was attempted."
          : "The disposable restore copy may be partially changed; the active database was not changed by this migration."
      );
    }
  } else {
    console.error(
      `Dayflow migration failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  process.exitCode = 1;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
