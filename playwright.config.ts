import { defineConfig, devices } from "@playwright/test";
import {
  testBackupDirectory,
  testDatabaseUrl
} from "./tests/e2e/database";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run test:e2e:server",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      DAYFLOW_BACKUP_DIRECTORY: testBackupDirectory,
      DAYFLOW_DISABLE_RESTORE: "1"
    }
  }
});
