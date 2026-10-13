import assert from "node:assert/strict";
import test from "node:test";
import { formatProjectTargetDateInput } from "../../src/components/projects-workspace";
import {
  parseProjectCreateMutation,
  parseProjectPatchMutation
} from "../../src/modules/projects/domain/project";
import { localDateKey, startOfLocalDay } from "../../src/shared/kernel/calendar";

test("formatProjectTargetDateInput handles empty and null inputs safely", () => {
  assert.equal(formatProjectTargetDateInput(null), "");
  assert.equal(formatProjectTargetDateInput(undefined), "");
  assert.equal(formatProjectTargetDateInput(""), "");
  assert.equal(formatProjectTargetDateInput("invalid-date"), "");
});

test("formatProjectTargetDateInput preserves date-only strings", () => {
  assert.equal(formatProjectTargetDateInput("2026-10-20"), "2026-10-20");
});

test("formatProjectTargetDateInput converts serialized UTC ISO dates to local civil day across timezones", () => {
  const originalTz = process.env.TZ;
  const testZones = [
    { zone: "Asia/Shanghai", expectedOffsetPositive: true },
    { zone: "Asia/Tokyo", expectedOffsetPositive: true },
    { zone: "UTC", expectedOffsetPositive: false },
    { zone: "America/Chicago", expectedOffsetPositive: false }
  ];

  try {
    for (const { zone } of testZones) {
      process.env.TZ = zone;
      const targetDate = "2026-10-20";

      // 1. Domain creates local Date at midnight in process timezone
      const created = parseProjectCreateMutation({
        name: "Test Project",
        targetDate
      });
      assert.ok(created.targetDate);

      // 2. HTTP response serializes Date to ISO UTC string
      const serializedIso = created.targetDate.toISOString();

      // 3. Old buggy behavior: ISO slice east of UTC shifts backwards
      const oldBuggySlice = serializedIso.slice(0, 10);
      const isEastOfUtc = new Date(created.targetDate).getTimezoneOffset() < 0;
      if (isEastOfUtc) {
        assert.equal(oldBuggySlice, "2026-10-19", `Expected old slice to shift backwards in ${zone}`);
      }

      // 4. Fixed behavior: formatProjectTargetDateInput preserves local civil day in all zones
      const fixedInput = formatProjectTargetDateInput(serializedIso);
      assert.equal(fixedInput, targetDate, `Expected local civil day in ${zone} to match original`);

      // 5. Simulated form save: unedited targetDate sent with updated description
      const patched = parseProjectPatchMutation({
        desiredOutcome: "Updated outcome only",
        targetDate: fixedInput
      });
      assert.ok(patched.data.targetDate);
      assert.equal(
        localDateKey(patched.data.targetDate),
        targetDate,
        `Expected round-trip patch in ${zone} to keep targetDate`
      );
    }
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  }
});
