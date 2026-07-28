import assert from "node:assert/strict";
import test from "node:test";
import {
  IdempotentMutationError,
  mutationRequestHash,
  parseMutationId
} from "../../src/lib/idempotent-mutations";

test("mutation identifiers are bounded and reject control characters", () => {
  assert.equal(parseMutationId(null), null);
  assert.equal(parseMutationId(" request-123 "), "request-123");
  assert.throws(
    () => parseMutationId("bad\nidentifier"),
    (error) =>
      error instanceof IdempotentMutationError &&
      error.code === "INVALID_MUTATION_ID"
  );
});

test("mutation request hashes are stable across object key order", () => {
  assert.equal(
    mutationRequestHash("task.create", {
      title: "One",
      nested: { second: 2, first: 1 }
    }),
    mutationRequestHash("task.create", {
      nested: { first: 1, second: 2 },
      title: "One"
    })
  );
  assert.notEqual(
    mutationRequestHash("task.create", { title: "One" }),
    mutationRequestHash("task.create", { title: "Two" })
  );
});
