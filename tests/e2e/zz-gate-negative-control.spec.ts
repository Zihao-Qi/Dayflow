import { expect, test } from "@playwright/test";

/**
 * Temporary. Proves the required check fails rather than skipping.
 *
 * The aggregate job carries the ruleset's required context "Reliability
 * gates". With a plain `needs:` a failing shard left it skipped, and GitHub
 * counts a skipped job as success for required checks - so the merge button
 * would have accepted a red shard. This spec fails on purpose so we can watch
 * the required check report failure. Delete this branch once observed.
 */
test("negative control: this assertion fails on purpose", async () => {
  expect(1).toBe(2);
});
