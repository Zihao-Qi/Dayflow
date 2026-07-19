import {
  prepareTestDatabase,
  testDatabasePath
} from "../tests/e2e/database";

prepareTestDatabase();

console.log(`Prepared disposable browser-test database at ${testDatabasePath}`);
