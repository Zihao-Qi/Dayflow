import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_CATEGORY_MAX_LENGTH,
  ACTIVITY_DURATION_MAX_MINUTES,
  ACTIVITY_NOTE_MAX_LENGTH,
  DIARY_CONTENT_MAX_LENGTH,
  DIARY_REFLECTION_MAX_LENGTH,
  EVIDENCE_RELATION_ID_MAX_LENGTH,
  EvidenceMutationRequestError,
  parseActivityCreateMutation,
  parseDiaryUpsertMutation,
  readEvidenceMutationBody
} from "../../src/lib/evidence-mutations";

function expectRequestError(
  action: () => unknown,
  field: string,
  code: "INVALID_JSON" | "VALIDATION_ERROR" = "VALIDATION_ERROR"
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof EvidenceMutationRequestError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

test("Activity input is normalized into one canonical timestamp", () => {
  const activity = parseActivityCreateMutation(
    {
      date: "2026-07-27",
      startTime: "09:05",
      durationMinutes: 25,
      category: "  Deep Work  ",
      note: "  Finished the reliability slice.  ",
      taskId: " task-1 ",
      projectId: " project-1 "
    },
    new Date("2026-07-01T12:00:00-05:00")
  );

  assert.equal(activity.startedAt.getFullYear(), 2026);
  assert.equal(activity.startedAt.getMonth(), 6);
  assert.equal(activity.startedAt.getDate(), 27);
  assert.equal(activity.startedAt.getHours(), 9);
  assert.equal(activity.startedAt.getMinutes(), 5);
  assert.equal(activity.durationMinutes, 25);
  assert.equal(activity.category, "Deep Work");
  assert.equal(activity.note, "Finished the reliability slice.");
  assert.equal(activity.taskId, "task-1");
  assert.equal(activity.projectId, "project-1");
});

test("Activity input uses one supplied clock for date, time, and defaults", () => {
  const now = new Date("2026-07-27T14:37:42-05:00");
  const activity = parseActivityCreateMutation(
    {
      durationMinutes: 15,
      note: "Record a defaulted Activity"
    },
    now
  );

  assert.equal(activity.startedAt.getFullYear(), now.getFullYear());
  assert.equal(activity.startedAt.getMonth(), now.getMonth());
  assert.equal(activity.startedAt.getDate(), now.getDate());
  assert.equal(activity.startedAt.getHours(), 14);
  assert.equal(activity.startedAt.getMinutes(), 37);
  assert.equal(activity.startedAt.getSeconds(), 0);
  assert.equal(activity.category, "Deep Work");
  assert.equal(activity.taskId, null);
  assert.equal(activity.projectId, null);
});

test("Activity duration, date, and time are strict and bounded", () => {
  for (const durationMinutes of [
    undefined,
    0,
    -1,
    1.5,
    ACTIVITY_DURATION_MAX_MINUTES + 1,
    "25",
    Number.NaN
  ]) {
    expectRequestError(
      () =>
        parseActivityCreateMutation({
          durationMinutes,
          note: "Invalid duration"
        }),
      "durationMinutes"
    );
  }

  for (const date of ["2026-02-30", "tomorrow", 20260727]) {
    expectRequestError(
      () =>
        parseActivityCreateMutation({
          date,
          durationMinutes: 25,
          note: "Invalid date"
        }),
      "date"
    );
  }

  for (const startTime of ["24:00", "9:05", "09:60", 905]) {
    expectRequestError(
      () =>
        parseActivityCreateMutation({
          startTime,
          durationMinutes: 25,
          note: "Invalid time"
        }),
      "startTime"
    );
  }
});

test("Activity text and relationship identifiers are bounded", () => {
  expectRequestError(
    () =>
      parseActivityCreateMutation({
        durationMinutes: 25,
        note: " "
      }),
    "note"
  );
  expectRequestError(
    () =>
      parseActivityCreateMutation({
        durationMinutes: 25,
        note: "x".repeat(ACTIVITY_NOTE_MAX_LENGTH + 1)
      }),
    "note"
  );
  expectRequestError(
    () =>
      parseActivityCreateMutation({
        durationMinutes: 25,
        note: "Valid note",
        category: "x".repeat(ACTIVITY_CATEGORY_MAX_LENGTH + 1)
      }),
    "category"
  );
  expectRequestError(
    () =>
      parseActivityCreateMutation({
        durationMinutes: 25,
        note: "Valid note",
        taskId: "x".repeat(EVIDENCE_RELATION_ID_MAX_LENGTH + 1)
      }),
    "taskId"
  );
  expectRequestError(
    () =>
      parseActivityCreateMutation({
        durationMinutes: 25,
        note: "Valid note",
        projectId: 42
      }),
    "projectId"
  );
});

test("Diary input applies canonical defaults without trimming writing", () => {
  const now = new Date("2026-07-27T16:20:00-05:00");
  const diary = parseDiaryUpsertMutation(
    {
      content: "  Keep my spacing.\n",
      reflection: "What worked? "
    },
    now
  );

  assert.equal(diary.date.getFullYear(), 2026);
  assert.equal(diary.date.getMonth(), 6);
  assert.equal(diary.date.getDate(), 27);
  assert.equal(diary.date.getHours(), 0);
  assert.equal(diary.content, "  Keep my spacing.\n");
  assert.equal(diary.reflection, "What worked? ");
  assert.equal(diary.mood, 3);
  assert.equal(diary.energy, 3);
});

test("Diary date, ratings, and writing are strict and bounded", () => {
  expectRequestError(
    () => parseDiaryUpsertMutation({ date: "2026-02-30" }),
    "date"
  );
  expectRequestError(
    () => parseDiaryUpsertMutation({ date: false }),
    "date"
  );

  for (const mood of [0, 1.5, 6, "4"]) {
    expectRequestError(() => parseDiaryUpsertMutation({ mood }), "mood");
  }
  for (const energy of [-1, 3.5, 10, "3"]) {
    expectRequestError(() => parseDiaryUpsertMutation({ energy }), "energy");
  }

  expectRequestError(
    () => parseDiaryUpsertMutation({ content: 42 }),
    "content"
  );
  expectRequestError(
    () =>
      parseDiaryUpsertMutation({
        content: "x".repeat(DIARY_CONTENT_MAX_LENGTH + 1)
      }),
    "content"
  );
  expectRequestError(
    () =>
      parseDiaryUpsertMutation({
        reflection: "x".repeat(DIARY_REFLECTION_MAX_LENGTH + 1)
      }),
    "reflection"
  );
});

test("Malformed and non-object evidence bodies produce typed errors", async () => {
  await assert.rejects(
    () =>
      readEvidenceMutationBody({
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceMutationRequestError);
      assert.equal(error.code, "INVALID_JSON");
      assert.equal(error.field, "body");
      return true;
    }
  );

  for (const value of [null, [], "text"]) {
    await assert.rejects(
      () => readEvidenceMutationBody({ json: async () => value }),
      (error: unknown) => {
        assert.ok(error instanceof EvidenceMutationRequestError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.field, "body");
        return true;
      }
    );
  }
});
