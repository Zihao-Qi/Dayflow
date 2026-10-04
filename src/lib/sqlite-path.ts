import { isAbsolute, resolve } from "node:path";

/** Keep Prisma, migration and backup paths relative to the schema directory. */
export function sqlitePathFromDatabaseUrl(
  databaseUrl: string,
  repositoryRoot = process.cwd()
) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a SQLite file URL such as file:./dev.db.");
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

export function sqliteDatabaseUrlForPath(path: string) {
  return `file:${encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F")}`;
}
