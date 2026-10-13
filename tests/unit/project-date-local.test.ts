import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { formatProjectTargetDateInput } from "../../src/components/projects-workspace";

test("formatProjectTargetDateInput handles empty and null inputs safely", () => {
  assert.equal(formatProjectTargetDateInput(null), "");
  assert.equal(formatProjectTargetDateInput(undefined), "");
  assert.equal(formatProjectTargetDateInput(""), "");
  assert.equal(formatProjectTargetDateInput("invalid-date"), "");
});

test("formatProjectTargetDateInput preserves date-only strings", () => {
  assert.equal(formatProjectTargetDateInput("2026-10-20"), "2026-10-20");
});

test("formatProjectTargetDateInput converts serialized UTC ISO dates in isolated timezone subprocesses", () => {
  const zones = ["Asia/Shanghai", "Asia/Tokyo", "UTC", "America/Chicago"];
  const script = `
    const assert = require("node:assert/strict");
    const { formatProjectTargetDateInput } = require("./src/components/projects-workspace.tsx");
    const { parseProjectCreateMutation, parseProjectPatchMutation } = require("./src/modules/projects/domain/project.ts");
    const { localDateKey } = require("./src/shared/kernel/calendar.ts");

    const targetDate = "2026-10-20";
    const created = parseProjectCreateMutation({ name: "Subprocess Project", targetDate });
    assert.ok(created.targetDate);
    const serializedIso = created.targetDate.toISOString();

    // Positive check: formatProjectTargetDateInput produces unchanged local date
    const fixedInput = formatProjectTargetDateInput(serializedIso);
    assert.equal(fixedInput, targetDate, "formatProjectTargetDateInput must preserve local civil day");

    // Positive check: saving patched project round-trips without date drift
    const patched = parseProjectPatchMutation({ desiredOutcome: "Unrelated edit", targetDate: fixedInput });
    assert.ok(patched.data.targetDate);
    assert.equal(localDateKey(patched.data.targetDate), targetDate, "Round-trip patch must preserve targetDate");
  `;

  for (const zone of zones) {
    execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: zone
      },
      stdio: "pipe"
    });
  }
});
