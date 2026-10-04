import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { sqliteDatabaseUrlForPath, sqlitePathFromDatabaseUrl } from "./sqlite-path";

/** No URL means generation is allowed, but database commands have no fallback. */
export function prismaDatasourceUrl(repositoryRoot: string, environment: Readonly<Record<string, string | undefined>>) {
  const envPath = join(repositoryRoot, ".env");
  const databaseUrl = environment.DATABASE_URL ?? (
    existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")).DATABASE_URL : undefined
  );
  if (!databaseUrl?.trim()) return undefined;
  return sqliteDatabaseUrlForPath(sqlitePathFromDatabaseUrl(databaseUrl.trim(), repositoryRoot));
}
