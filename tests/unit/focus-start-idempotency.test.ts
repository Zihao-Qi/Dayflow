import assert from "node:assert/strict";
import test from "node:test";
import { prepareFocusStartAttempt } from "../../src/lib/focus-start-idempotency";

test("Focus start retries keep one mutation identifier for the same logical payload", () => {
  let generated = 0;
  const createMutationId = () => `focus-start-${++generated}`;

  const first = prepareFocusStartAttempt(
    null,
    {
      plannedMinutes: 25,
      label: "Write draft",
      taskId: "task-1",
      projectId: null
    },
    createMutationId
  );
  const retry = prepareFocusStartAttempt(
    first,
    {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Write draft",
      taskId: "task-1",
      projectId: null
    },
    createMutationId
  );
  const changed = prepareFocusStartAttempt(
    retry,
    {
      kind: "FOCUS",
      plannedMinutes: 50,
      label: "Write draft",
      taskId: "task-1",
      projectId: null
    },
    createMutationId
  );

  assert.equal(first.mutationId, "focus-start-1");
  assert.equal(retry.mutationId, first.mutationId);
  assert.deepEqual(retry.payload, first.payload);
  assert.equal(changed.mutationId, "focus-start-2");
});

test("Focus start retries canonicalize omitted and blank labels identically", () => {
  let generated = 0;
  const createMutationId = () => `focus-start-${++generated}`;
  const omitted = prepareFocusStartAttempt(
    null,
    { plannedMinutes: 25 },
    createMutationId
  );
  const blank = prepareFocusStartAttempt(
    omitted,
    { plannedMinutes: 25, label: "   " },
    createMutationId
  );

  assert.equal(blank.mutationId, omitted.mutationId);
  assert.deepEqual(blank.payload, omitted.payload);
  assert.equal("label" in blank.payload, false);
});
