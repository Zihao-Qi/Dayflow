import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

export const testDatabasePath = "/private/tmp/dayflow-playwright.db";

rmSync(testDatabasePath, { force: true });
execFileSync("/usr/bin/sqlite3", [testDatabasePath, ".read prisma/init.sql"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit"
});

console.log(`Prepared disposable browser-test database at ${testDatabasePath}`);
