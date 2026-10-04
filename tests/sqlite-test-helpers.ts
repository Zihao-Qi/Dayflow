import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sqlitePathFromDatabaseUrl } from "../src/lib/sqlite-path";
import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../src/server/prisma/sqlite";

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

/** Each fixture owns a client; a disconnected adapter keeps its original URL. */
export function injectedTestClient(databaseUrl: string) {
  const globalClient = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globalClient.prisma;
  const database = new PrismaClient({ adapter: createSqliteAdapter(databaseUrl) });
  globalClient.prisma = database;
  return {
    database,
    async close() {
      try { await database.$disconnect(); }
      finally {
        if (previous === undefined) delete globalClient.prisma;
        else globalClient.prisma = previous;
      }
    }
  };
}
