import { createSqliteAdapter } from "../src/server/prisma/sqlite";

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
