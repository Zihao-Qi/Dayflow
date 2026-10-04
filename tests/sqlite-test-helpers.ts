import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sqlitePathFromDatabaseUrl } from "../src/lib/sqlite-path";

/** Initialize the disposable integration-test database with the production schema. */
export function initializeTestDatabase(databaseUrl: string): void {
  const database = new DatabaseSync(sqlitePathFromDatabaseUrl(databaseUrl));
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec(readFileSync("prisma/init.sql", "utf8"));
  } finally {
    database.close();
  }
}
