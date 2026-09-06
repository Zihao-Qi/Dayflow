import { frozenClock } from "../../src/shared/kernel/calendar";
import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_ESTIMATE_MAX_MINUTES,
  TASK_TITLE_MAX_LENGTH,
  TaskMutationValidationError,
  parseTaskCreateMutation,
  parseTaskPatchMutation,
  readTaskMutationBody
} from "../../src/lib/task-mutations";

import { projectErrors } from "../../src/lib/project-errors";

function expectValidationError(
  action: () => unknown,
  field: string,
  code: "INVALID_JSON" | "VALIDATION_ERROR" = "VALIDATION_ERROR"
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof TaskMutationValidationError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

test("task create parser returns normalized defaults", () => {
  const now = new Date("2026-07-27T14:30:00-05:00");
  const parsed = parseTaskCreateMutation({ title: "  Ship parser  " }, now);

  assert.equal(parsed.title, "Ship parser");
  assert.equal(parsed.date?.getHours(), 0);
  assert.equal(parsed.date?.getDate(), 27);
  assert.equal(parsed.priority, "MEDIUM");
  assert.equal(parsed.status, "TODO");
  assert.equal(parsed.urgentScore, 2);
  assert.equal(parsed.importanceScore, 3);
  assert.equal(parsed.deadline, null);
  assert.equal(parsed.estimateMinutes, 30);
  assert.equal(parsed.projectId, null);
  assert.equal(parsed.phaseId, null);
});

test("task create parser requires a bounded non-empty title", () => {
  expectValidationError(() => parseTaskCreateMutation({}, testClock.now()), "title");
  expectValidationError(
    () => parseTaskCreateMutation({ title: " \n\t " }, testClock.now()),
    "title"
  );
  expectValidationError(
    () =>
      parseTaskCreateMutation({
        title: "x".repeat(TASK_TITLE_MAX_LENGTH + 1)
      }, testClock.now()),
    "title"
  );
});

test("task parser rejects invalid enum values", () => {
  expectValidationError(
    () => parseTaskCreateMutation({ title: "Task", status: "finished" }, testClock.now()),
    "status"
  );
  expectValidationError(
    () => parseTaskCreateMutation({ title: "Task", priority: "urgent" }, testClock.now()),
    "priority"
  );
  expectValidationError(
    () => parseTaskCreateMutation({ title: "Task", status: 1 }, testClock.now()),
    "status"
  );
});

test("task parser rejects invalid scheduled dates and deadlines", () => {
  expectValidationError(
    () => parseTaskCreateMutation({ title: "Task", date: "2026-02-30" }, testClock.now()),
    "date"
  );
  expectValidationError(
    () =>
      parseTaskCreateMutation({
        title: "Task",
        deadline: "tomorrow"
      }, testClock.now()),
    "deadline"
  );
  expectValidationError(
    () => parseTaskCreateMutation({ title: "Task", deadline: false }, testClock.now()),
    "deadline"
  );

  const parsed = parseTaskCreateMutation({
    title: "Task",
    date: null,
    deadline: ""
  }, testClock.now());
  assert.equal(parsed.date, null);
  assert.equal(parsed.deadline, null);
});

test("task parser requires whole bounded estimate and score numbers", () => {
  for (const estimateMinutes of [
    -1,
    1.5,
    TASK_ESTIMATE_MAX_MINUTES + 1,
    "30"
  ]) {
    expectValidationError(
      () => parseTaskCreateMutation({ title: "Task", estimateMinutes }, testClock.now()),
      "estimateMinutes"
    );
  }

  for (const urgentScore of [0, 2.5, 6, "4"]) {
    expectValidationError(
      () => parseTaskCreateMutation({ title: "Task", urgentScore }, testClock.now()),
      "urgentScore"
    );
  }

  assert.equal(
    parseTaskCreateMutation({ title: "Task", estimateMinutes: 0 }, testClock.now())
      .estimateMinutes,
    0
  );
});

test("task patch parser shares field validation and preserves placement", () => {
  const current = {
    projectId: "project-a",
    phaseId: "phase-a",
    status: "IN_PROGRESS" as const
  };
  const parsed = parseTaskPatchMutation(
    {
      title: "  Updated  ",
      estimateMinutes: 45,
      urgentScore: 5,
      deadline: "2026-08-01"
    },
    current, testClock.now()
  );

  assert.equal(parsed.data.title, "Updated");
  assert.equal(parsed.data.estimateMinutes, 45);
  assert.equal(parsed.data.urgentScore, 5);
  assert.equal(parsed.data.deadline?.getDate(), 1);
  assert.equal(parsed.projectId, "project-a");
  assert.equal(parsed.phaseId, "phase-a");
  assert.deepEqual(
    Object.prototype.hasOwnProperty.call(parsed.data, "projectId"),
    false
  );

  expectValidationError(
    () => parseTaskPatchMutation({ title: " " }, current, testClock.now()),
    "title"
  );
  expectValidationError(
    () => parseTaskPatchMutation({ importanceScore: 1.2 }, current, testClock.now()),
    "importanceScore"
  );
});

test("moving a task to another project clears an omitted phase", () => {
  const parsed = parseTaskPatchMutation(
    { projectId: "project-b" },
    {
      projectId: "project-a",
      phaseId: "phase-a",
      status: "TODO"
    }, testClock.now()
  );

  assert.equal(parsed.projectId, "project-b");
  assert.equal(parsed.phaseId, null);
  assert.equal(parsed.data.projectId, "project-b");
  assert.equal(parsed.data.phaseId, null);
});

test("task patch parser records status transitions and schedule source", () => {
  const now = new Date("2026-07-27T16:45:00-05:00");
  const parsed = parseTaskPatchMutation(
    {
      status: "DONE",
      date: "2026-07-28",
      scheduleSource: "unfinished-to-today"
    },
    {
      projectId: null,
      phaseId: null,
      status: "TODO"
    },
    now
  );

  assert.equal(parsed.requestedStatus, "DONE");
  assert.equal(parsed.status, "DONE");
  assert.equal(parsed.data.completedAt, now);
  assert.equal(parsed.scheduleSource, "unfinished-to-today");

  const reopened = parseTaskPatchMutation(
    { status: "TODO" },
    {
      projectId: null,
      phaseId: null,
      status: "DONE"
    },
    now
  );
  assert.equal(reopened.data.completedAt, null);
});

test("malformed and non-object JSON bodies produce typed parse errors", async () => {
  await assert.rejects(
    () =>
      readTaskMutationBody({
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskMutationValidationError);
      assert.equal(error.code, "INVALID_JSON");
      assert.equal(error.field, "body");
      return true;
    }
  );

  await assert.rejects(
    () => readTaskMutationBody({ json: async () => [] }),
    (error: unknown) => {
      assert.ok(error instanceof TaskMutationValidationError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.field, "body");
      return true;
    }
  );
});

test("task relationship errors distinguish missing and conflicting placement", () => {
  assert.deepEqual(
    placementDetails(projectErrors.theSelectedProjectCouldNotBeFound),
    {
      code: "RELATIONSHIP_NOT_FOUND",
      field: "projectId",
      status: 404
    }
  );
  assert.deepEqual(
    placementDetails(projectErrors.theSelectedPhaseDoesNotBelongToThisProject),
    {
      code: "RELATIONSHIP_CONFLICT",
      field: "phaseId",
      status: 409
    }
  );
  assert.deepEqual(
    placementDetails(projectErrors.aTaskCannotHaveAPhaseWithoutAProject),
    {
      code: "VALIDATION_ERROR",
      field: "phaseId",
      status: 400
    }
  );
});

function placementDetails({ code, field, status }: { code: string; field: string; status: number }) {
  return { code, field, status };
}

const testClock = frozenClock(new Date("2026-07-27T12:00:00-05:00"));
