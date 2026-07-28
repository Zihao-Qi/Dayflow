import assert from "node:assert/strict";
import test from "node:test";
import {
  FOCUS_CATEGORY_MAX_LENGTH,
  FOCUS_COMPLETION_NOTE_MAX_LENGTH,
  FOCUS_LABEL_MAX_LENGTH,
  WORKFLOW_ID_ARRAY_MAX_ITEMS,
  WORKFLOW_ID_MAX_LENGTH,
  WorkflowMutationRequestError,
  parseFocusQueueAddMutation,
  parseFocusQueueRemoveMutation,
  parseFocusQueueReorderMutation,
  parseFocusSessionStartMutation,
  parseFocusSessionTransitionMutation,
  parseTaskReorderMutation,
  parseWorkflowId,
  readWorkflowMutationBody
} from "../../src/lib/workflow-mutations";

function expectRequestError(
  action: () => unknown,
  field: string,
  code: "INVALID_JSON" | "VALIDATION_ERROR" = "VALIDATION_ERROR"
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof WorkflowMutationRequestError);
    assert.equal(error.field, field);
    assert.equal(error.code, code);
    return true;
  });
}

test("workflow bodies reject malformed JSON and non-object values", async () => {
  await assert.rejects(
    () =>
      readWorkflowMutationBody({
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowMutationRequestError);
      assert.equal(error.code, "INVALID_JSON");
      assert.equal(error.field, "body");
      return true;
    }
  );

  for (const value of [null, [], "body"]) {
    await assert.rejects(
      () => readWorkflowMutationBody({ json: async () => value }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowMutationRequestError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.field, "body");
        return true;
      }
    );
  }
});

test("focus queue mutations normalize identifiers and enforce exact placement", () => {
  assert.deepEqual(
    parseFocusQueueAddMutation({
      taskId: " task-1 ",
      placement: "next"
    }),
    { taskId: "task-1", placement: "next" }
  );
  assert.deepEqual(parseFocusQueueRemoveMutation({ taskId: " task-1 " }), {
    taskId: "task-1"
  });

  expectRequestError(
    () => parseFocusQueueAddMutation({ taskId: "task-1", placement: "first" }),
    "placement"
  );
  expectRequestError(
    () => parseFocusQueueRemoveMutation({ taskId: 42 }),
    "taskId"
  );
});

test("queue and task reorder arrays are required, bounded, and unique", () => {
  assert.deepEqual(
    parseFocusQueueReorderMutation({
      ids: ["task-2", "task-1"],
      expectedIds: ["task-1", "task-2"]
    }),
    {
      ids: ["task-2", "task-1"],
      expectedIds: ["task-1", "task-2"]
    }
  );
  assert.deepEqual(parseTaskReorderMutation({ ids: [] }), { ids: [] });

  expectRequestError(
    () => parseFocusQueueReorderMutation({ ids: [], expectedIds: "task-1" }),
    "expectedIds"
  );
  expectRequestError(
    () => parseTaskReorderMutation({ ids: ["task-1", "task-1"] }),
    "ids"
  );
  expectRequestError(
    () =>
      parseTaskReorderMutation({
        ids: Array.from(
          { length: WORKFLOW_ID_ARRAY_MAX_ITEMS + 1 },
          (_, index) => `task-${index}`
        )
      }),
    "ids"
  );
});

test("focus starts use strict durations and bounded text and relationships", () => {
  assert.deepEqual(
    parseFocusSessionStartMutation({
      kind: " focus ",
      plannedMinutes: 25,
      label: " Reliability pass ",
      taskId: " task-1 ",
      projectId: null
    }),
    {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Reliability pass",
      taskId: "task-1",
      projectId: null
    }
  );
  assert.equal(
    parseFocusSessionStartMutation({ plannedMinutes: 5 }).kind,
    "FOCUS"
  );
  assert.equal(
    parseFocusSessionStartMutation({
      plannedMinutes: 5,
      label: "   "
    }).label,
    undefined
  );

  for (const plannedMinutes of [0, 2.5, 241, "25"]) {
    expectRequestError(
      () => parseFocusSessionStartMutation({ plannedMinutes }),
      "plannedMinutes"
    );
  }
  expectRequestError(
    () =>
      parseFocusSessionStartMutation({
        plannedMinutes: 25,
        label: "x".repeat(FOCUS_LABEL_MAX_LENGTH + 1)
      }),
    "label"
  );
  expectRequestError(
    () =>
      parseFocusSessionStartMutation({
        plannedMinutes: 25,
        projectId: "x".repeat(WORKFLOW_ID_MAX_LENGTH + 1)
      }),
    "projectId"
  );
});

test("focus transitions accept known actions and strictly bound enrichment", () => {
  assert.deepEqual(
    parseFocusSessionTransitionMutation({
      action: " ENRICH ",
      note: " Completed the slice. ",
      category: " Deep Work ",
      taskCompleted: false
    }),
    {
      action: "enrich",
      note: "Completed the slice.",
      category: "Deep Work",
      taskCompleted: false
    }
  );

  expectRequestError(
    () => parseFocusSessionTransitionMutation({ action: "restart" }),
    "action"
  );
  expectRequestError(
    () =>
      parseFocusSessionTransitionMutation({
        action: "enrich",
        note: "x".repeat(FOCUS_COMPLETION_NOTE_MAX_LENGTH + 1)
      }),
    "note"
  );
  expectRequestError(
    () =>
      parseFocusSessionTransitionMutation({
        action: "record",
        category: "x".repeat(FOCUS_CATEGORY_MAX_LENGTH + 1)
      }),
    "category"
  );
  expectRequestError(
    () =>
      parseFocusSessionTransitionMutation({
        action: "enrich",
        taskCompleted: "yes"
      }),
    "taskCompleted"
  );
});

test("path identifiers reject empty, overlong, and control characters", () => {
  assert.equal(parseWorkflowId(" activity-1 ", "id"), "activity-1");
  for (const id of [
    "",
    " ",
    "x".repeat(WORKFLOW_ID_MAX_LENGTH + 1),
    "task-\u0000"
  ]) {
    expectRequestError(() => parseWorkflowId(id, "id"), "id");
  }
});
