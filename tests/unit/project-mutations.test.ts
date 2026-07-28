import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE_NAME_MAX_LENGTH,
  PHASE_SORT_ORDER_MAX,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_OUTCOME_MAX_LENGTH,
  PROJECT_TARGET_DURATION_MAX,
  PROJECT_WEEKLY_BUDGET_MAX_MINUTES,
  ProjectMutationRequestError,
  parsePhaseCreateMutation,
  parsePhasePatchMutation,
  parseProjectCreateMutation,
  parseProjectPatchMutation,
  readProjectMutationBody
} from "../../src/lib/project-mutations";

function expectValidationError(action: () => unknown, field: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ProjectMutationRequestError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.field, field);
    assert.equal(error.status, 400);
    return true;
  });
}

test("Project create parser normalizes a complete valid payload", () => {
  const parsed = parseProjectCreateMutation({
    name: "  Ship reliability  ",
    desiredOutcome: "  Recoverable local data  ",
    targetDate: "2026-08-31",
    targetDurationValue: 6,
    targetDurationUnit: "weeks",
    weeklyMinutesBudget: 300,
    status: "paused"
  });

  assert.equal(parsed.name, "Ship reliability");
  assert.equal(parsed.desiredOutcome, "Recoverable local data");
  assert.equal(parsed.targetDate?.getFullYear(), 2026);
  assert.equal(parsed.targetDate?.getMonth(), 7);
  assert.equal(parsed.targetDate?.getDate(), 31);
  assert.equal(parsed.targetDurationValue, 6);
  assert.equal(parsed.targetDurationUnit, "WEEKS");
  assert.equal(parsed.weeklyMinutesBudget, 300);
  assert.equal(parsed.status, "PAUSED");
});

test("Project create parser supplies stable optional defaults", () => {
  const parsed = parseProjectCreateMutation({ name: "Project" });

  assert.equal(parsed.desiredOutcome, "");
  assert.equal(parsed.targetDate, null);
  assert.equal(parsed.targetDurationValue, null);
  assert.equal(parsed.targetDurationUnit, null);
  assert.equal(parsed.weeklyMinutesBudget, null);
  assert.equal(parsed.status, "ACTIVE");
});

test("Project parser bounds required and optional text", () => {
  expectValidationError(() => parseProjectCreateMutation({}), "name");
  expectValidationError(
    () => parseProjectCreateMutation({ name: " \n " }),
    "name"
  );
  expectValidationError(
    () =>
      parseProjectCreateMutation({
        name: "x".repeat(PROJECT_NAME_MAX_LENGTH + 1)
      }),
    "name"
  );
  expectValidationError(
    () =>
      parseProjectCreateMutation({
        name: "Project",
        desiredOutcome: "x".repeat(PROJECT_OUTCOME_MAX_LENGTH + 1)
      }),
    "desiredOutcome"
  );
});

test("Project parser rejects invalid dates, lifecycle, and confirmation", () => {
  expectValidationError(
    () =>
      parseProjectCreateMutation({
        name: "Project",
        targetDate: "2026-02-30"
      }),
    "targetDate"
  );
  expectValidationError(
    () => parseProjectCreateMutation({ name: "Project", status: "OPEN" }),
    "status"
  );
  expectValidationError(
    () => parseProjectPatchMutation({ confirm: "yes" }),
    "confirm"
  );
});

test("Project parser requires bounded whole duration and weekly budget values", () => {
  for (const targetDurationValue of [
    0,
    1.5,
    PROJECT_TARGET_DURATION_MAX + 1,
    "6"
  ]) {
    expectValidationError(
      () =>
        parseProjectCreateMutation({
          name: "Project",
          targetDurationValue,
          targetDurationUnit: "WEEKS"
        }),
      "targetDurationValue"
    );
  }
  expectValidationError(
    () =>
      parseProjectCreateMutation({
        name: "Project",
        targetDurationValue: 6
      }),
    "targetDurationUnit"
  );
  expectValidationError(
    () =>
      parseProjectCreateMutation({
        name: "Project",
        targetDurationValue: 6,
        targetDurationUnit: "MONTHS"
      }),
    "targetDurationUnit"
  );

  for (const weeklyMinutesBudget of [
    0,
    1.5,
    PROJECT_WEEKLY_BUDGET_MAX_MINUTES + 1,
    "300"
  ]) {
    expectValidationError(
      () =>
        parseProjectCreateMutation({
          name: "Project",
          weeklyMinutesBudget
        }),
      "weeklyMinutesBudget"
    );
  }
});

test("Project patch parser shares field validation and only emits supplied fields", () => {
  const parsed = parseProjectPatchMutation({
    name: "  Renamed  ",
    targetDate: null,
    targetDurationValue: null,
    targetDurationUnit: null,
    weeklyMinutesBudget: 120,
    status: "completed",
    confirm: true
  });

  assert.deepEqual(parsed.data, {
    name: "Renamed",
    targetDate: null,
    targetDurationValue: null,
    targetDurationUnit: null,
    weeklyMinutesBudget: 120,
    status: "COMPLETED"
  });
  assert.equal(parsed.confirmCompletion, true);
  assert.deepEqual(parseProjectPatchMutation({}), {
    data: {},
    confirmCompletion: false
  });

  expectValidationError(
    () => parseProjectPatchMutation({ name: false }),
    "name"
  );
});

test("Phase parsers require bounded names and non-negative whole order", () => {
  assert.deepEqual(parsePhaseCreateMutation({ name: "  Discovery  " }), {
    name: "Discovery"
  });
  assert.deepEqual(
    parsePhasePatchMutation({ name: "  Delivery  ", sortOrder: 4 }),
    { name: "Delivery", sortOrder: 4 }
  );

  expectValidationError(() => parsePhaseCreateMutation({ name: "" }), "name");
  expectValidationError(
    () =>
      parsePhaseCreateMutation({
        name: "x".repeat(PHASE_NAME_MAX_LENGTH + 1)
      }),
    "name"
  );
  for (const sortOrder of [-1, 1.5, PHASE_SORT_ORDER_MAX + 1, "2"]) {
    expectValidationError(
      () => parsePhasePatchMutation({ sortOrder }),
      "sortOrder"
    );
  }
});

test("Project mutation body reader types malformed JSON and non-object bodies", async () => {
  await assert.rejects(
    () =>
      readProjectMutationBody({
        json: async () => {
          throw new SyntaxError("bad json");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectMutationRequestError);
      assert.equal(error.code, "INVALID_JSON");
      assert.equal(error.field, "body");
      return true;
    }
  );

  await assert.rejects(
    () => readProjectMutationBody({ json: async () => [] }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectMutationRequestError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.field, "body");
      return true;
    }
  );
});
