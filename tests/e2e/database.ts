import { execFileSync } from "node:child_process";

const testDatabasePath = "/private/tmp/dayflow-playwright.db";

export function resetTestDatabase() {
  execFileSync(
    "/usr/bin/sqlite3",
    [
      testDatabasePath,
      [
        "PRAGMA foreign_keys = OFF;",
        'DELETE FROM "ActivityEntry";',
        'DELETE FROM "TimeBlock";',
        'DELETE FROM "Material";',
        'DELETE FROM "Note";',
        'DELETE FROM "DiaryEntry";',
        'DELETE FROM "Task";',
        "PRAGMA foreign_keys = ON;"
      ].join(" ")
    ],
    { stdio: "inherit" }
  );
}
