import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { sqlitePathFromDatabaseUrl } from "../../lib/sqlite-path";

/** The factory captures a path; SQLite opens only when Prisma first connects. */
export function createSqliteAdapter(databaseUrl: string, repositoryRoot = process.cwd()) {
  return new PrismaBetterSqlite3(
    { url: sqlitePathFromDatabaseUrl(databaseUrl, repositoryRoot) },
    // Prisma 6 stores DateTime as INTEGER milliseconds. ISO text makes range
    // predicates miss old rows even though reading those rows still works.
    { timestampFormat: "unixepoch-ms" }
  );
}
