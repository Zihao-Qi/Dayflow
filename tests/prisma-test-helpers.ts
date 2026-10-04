import { PrismaClient } from "@prisma/client";
import { after } from "node:test";
import { createSqliteAdapter } from "../src/server/prisma/sqlite";

type GlobalWithPrisma = typeof globalThis & { prisma?: PrismaClient };

/** Supply a client that fails loudly if a unit test reaches SQLite. */
export function injectedUnitTestClient(): PrismaClient {
  const globalForPrisma = globalThis as GlobalWithPrisma;
  const hadOwnInjection = Object.hasOwn(globalThis, "prisma");
  const previousInjection = globalForPrisma.prisma;
  const client = new PrismaClient({
    adapter: {
      adapterName: "unit-test",
      provider: "sqlite",
      async connect() {
        throw new Error("Unit test attempted an unmocked SQLite connection");
      }
    }
  });
  globalForPrisma.prisma = client;

  after(async () => {
    try {
      await client.$disconnect();
    } finally {
      if (hadOwnInjection) globalForPrisma.prisma = previousInjection;
      else delete globalForPrisma.prisma;
    }
  });

  return client;
}

/** Prisma's query events omit BEGIN issued directly by its SQLite adapter. */
export function observedSqliteAdapter(databaseUrl: string, onStarted: () => void) {
  const adapter = createSqliteAdapter(databaseUrl);
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const driver = await connect();
    const startTransaction = driver.startTransaction.bind(driver);
    driver.startTransaction = async (...args) => {
      const transaction = await startTransaction(...args);
      // Observe successful adapter start, not a request to open a transaction.
      // The route's real SELECT/COMMIT events remain independently recorded.
      onStarted();
      return transaction;
    };
    return driver;
  };
  return adapter;
}
