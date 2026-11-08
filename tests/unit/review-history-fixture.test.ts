import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cases = [
  {
    label: "fall-back within the seven-day period",
    today: "2026-11-08T12:00:00-06:00",
    offset: 3,
    start: "2026-10-30T05:00:00.000Z",
    end: "2026-11-06T06:00:00.000Z"
  },
  {
    label: "fall-back within the offset from today",
    today: "2026-11-08T12:00:00-06:00",
    offset: 9,
    start: "2026-10-24T05:00:00.000Z",
    end: "2026-10-31T05:00:00.000Z"
  },
  {
    label: "spring-forward within the seven-day period",
    today: "2026-03-12T12:00:00-05:00",
    offset: 2,
    start: "2026-03-04T06:00:00.000Z",
    end: "2026-03-11T05:00:00.000Z"
  },
  {
    label: "spring-forward within the offset from today",
    today: "2026-03-12T12:00:00-05:00",
    offset: 6,
    start: "2026-02-28T06:00:00.000Z",
    end: "2026-03-07T06:00:00.000Z"
  }
];

for (const { label, today, offset, start, end } of cases) {
  test(`seedPastReviews uses civil boundaries across ${label}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "dayflow-review-history-fixture-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));

    // A child owns the fixture's os.tmpdir paths, Chicago timezone and mocked
    // clock. No shared browser database or other test's Date/TZ is touched.
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "--eval", `
        const assert = require("node:assert/strict");
        const { join } = require("node:path");
        const { mock } = require("node:test");
        const { DatabaseSync } = require("node:sqlite");
        const fixture = require("./tests/e2e/database.ts");
        assert.equal(fixture.testDatabasePath, join(process.env.TMPDIR, "dayflow-playwright.db"));
        assert.equal(fixture.testBackupDirectory, join(process.env.TMPDIR, "dayflow-playwright-backups"));
        assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Chicago");
        mock.timers.enable({ apis: ["Date"], now: new Date(${JSON.stringify(today)}) });
        try {
          fixture.prepareTestDatabase();
          const [metadata] = fixture.seedPastReviews([${offset}]);
          const database = new DatabaseSync(fixture.testDatabasePath, { readOnly: true });
          try {
            const rows = database.prepare('SELECT id, periodStart, periodEnd, narrative, nextPeriodIntention FROM "Review"').all();
            console.log(JSON.stringify({ metadata, rows }));
          } finally {
            database.close();
          }
        } finally {
          mock.timers.reset();
        }
      `
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "America/Chicago",
        TMPDIR: directory,
        DATABASE_URL: `file:${join(directory, "install.db")}`,
        DAYFLOW_BACKUP_DIRECTORY: join(directory, "backups"),
        DAYFLOW_DISABLE_RESTORE: "1"
      },
      encoding: "utf8",
      timeout: 15_000
    });
    const actual = JSON.parse(output);
    const expected = {
      id: `past-review-${offset}`,
      periodStart: Date.parse(start),
      periodEnd: Date.parse(end),
      narrative: `Saved ${offset} days ago`,
      nextPeriodIntention: `Intention from ${offset} days ago`
    };
    assert.deepEqual(actual, {
      metadata: { ...expected, daysAgo: offset },
      rows: [expected]
    }, "returned metadata and persisted Review must match literal civil boundaries");
  });
}
