import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  buildActivityCategorySuggestions,
  DEFAULT_ACTIVITY_CATEGORIES
} from "../../src/lib/activity-categories";

test("Activity category suggestions keep stable defaults before custom labels", () => {
  assert.deepEqual(
    buildActivityCategorySuggestions([]),
    [...DEFAULT_ACTIVITY_CATEGORIES]
  );
  assert.deepEqual(
    buildActivityCategorySuggestions([
      "Writing",
      "Coding",
      "Deep Work"
    ]),
    [...DEFAULT_ACTIVITY_CATEGORIES, "Coding", "Writing"]
  );
});

test("Activity category suggestions normalize, bound, and deduplicate labels", () => {
  assert.deepEqual(
    buildActivityCategorySuggestions([
      " writing ",
      "WRITING",
      "deep work",
      "  ",
      "Zebra",
      "alpha",
      "x".repeat(ACTIVITY_CATEGORY_MAX_LENGTH + 1)
    ]),
    [...DEFAULT_ACTIVITY_CATEGORIES, "alpha", "writing", "Zebra"]
  );
});
