import assert from "node:assert/strict";
import test from "node:test";
import { localDateKey } from "../../src/lib/dates";
import {
  TIME_BLOCK_ID_MAX_LENGTH,
  TIME_BLOCK_TASK_ID_MAX_LENGTH,
  TIME_BLOCK_TITLE_MAX_LENGTH,
  TimeBlockError,
  assertTimeBlockIsNotPast,
  isTimeBlockRecord,
  minuteIntervalsOverlap,
  minutesToTimeBlockTime,
  parseTimeBlockDraft,
  parseTimeBlockDraftStructure,
  parseTimeBlockPathId,
  readTimeBlockMutationBody,
  timeBlockDurationMinutes,
  timeBlockIntervalToMinutes,
  timeBlockIntervalsOverlap,
  timeBlockTimeToMinutes
} from "../../src/lib/time-blocks";

function expectTimeBlockError(
  action: () => unknown,
  field: string,
  code:
    | "INVALID_JSON"
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "RELATIONSHIP_NOT_FOUND"
    | "RELATIONSHIP_CONFLICT"
    | "TIME_BLOCK_OVERLAP" = "VALIDATION_ERROR"
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof TimeBlockError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

const validDraft = {
  date: "2026-07-28",
  startTime: "09:05",
  endTime: "10:35",
  title: "  Draft the day plan  ",
  taskId: " task-1 "
};
const now = new Date("2026-07-28T12:00:00-05:00");
const parseDraft = (value: unknown) => parseTimeBlockDraft(value, now);

test("Time Block input canonicalizes one valid full replacement", () => {
  const draft = parseDraft(validDraft);

  assert.equal(draft.date.getFullYear(), 2026);
  assert.equal(draft.date.getMonth(), 6);
  assert.equal(draft.date.getDate(), 28);
  assert.equal(draft.date.getHours(), 0);
  assert.equal(draft.startTime, "09:05");
  assert.equal(draft.endTime, "10:35");
  assert.equal(draft.title, "Draft the day plan");
  assert.equal(draft.taskId, "task-1");
});

test("Time Block input accepts an explicitly empty Task relationship", () => {
  for (const taskId of [undefined, null, ""]) {
    assert.equal(
      parseDraft({ ...validDraft, taskId }).taskId,
      null
    );
  }
});

test("Time Block dates are strict local calendar dates", () => {
  for (const date of [
    undefined,
    null,
    20260728,
    "2026-7-28",
    "2026-02-30",
    "2026-13-01",
    "2026-07-28T00:00:00.000Z"
  ]) {
    expectTimeBlockError(
      () => parseDraft({ ...validDraft, date }),
      "date"
    );
  }
});

test("parsing a draft refuses a day that has ended and accepts a later one", () => {
  // Day Navigation v1 widened this forward: 2026-07-29 was refused under
  // Manual Time Blocks v1, which allowed today alone.
  expectTimeBlockError(
    () => parseDraft({ ...validDraft, date: "2026-07-27" }),
    "date"
  );
  assert.equal(
    localDateKey(parseDraft({ ...validDraft, date: "2026-07-29" }).date),
    "2026-07-29"
  );
});

test("structural parsing stays replay-safe while day validation is explicit", () => {
  const previousDay = parseTimeBlockDraftStructure({
    ...validDraft,
    date: "2026-07-27"
  });
  assert.equal(localDateKey(previousDay.date), "2026-07-27");
  expectTimeBlockError(
    () => assertTimeBlockIsNotPast(previousDay, now),
    "date"
  );
});

test("a Time Block may be planned for today or later, never for a day that ended", () => {
  // `now` is fixed at 2026-07-28 by this suite.
  const on = (date: string) =>
    parseTimeBlockDraftStructure({ ...validDraft, date });

  // Today and future days are allowed.
  assert.doesNotThrow(() => assertTimeBlockIsNotPast(on("2026-07-28"), now));
  assert.doesNotThrow(() => assertTimeBlockIsNotPast(on("2026-07-29"), now));
  assert.doesNotThrow(() => assertTimeBlockIsNotPast(on("2026-09-22"), now));

  // Any earlier day is refused, including the one immediately before.
  for (const date of ["2026-07-27", "2026-07-01", "2025-12-31"]) {
    expectTimeBlockError(
      () => assertTimeBlockIsNotPast(on(date), now),
      "date"
    );
  }
});

test("the widened rule keeps its boundary at the local day, not the instant", () => {
  const lateToday = new Date(2026, 6, 28, 23, 59, 59);
  assert.doesNotThrow(() =>
    assertTimeBlockIsNotPast(
      parseTimeBlockDraftStructure({ ...validDraft, date: "2026-07-28" }),
      lateToday
    )
  );
  expectTimeBlockError(
    () =>
      assertTimeBlockIsNotPast(
        parseTimeBlockDraftStructure({ ...validDraft, date: "2026-07-27" }),
        lateToday
      ),
    "date"
  );
});

test("local calendar keys do not shift to the prior day in UTC-positive zones", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const localMidnight = new Date(2026, 6, 28);
    const serializedTaskDate = localMidnight.toISOString();
    assert.equal(serializedTaskDate.slice(0, 10), "2026-07-27");
    assert.equal(localDateKey(localMidnight), "2026-07-28");
    assert.equal(
      localDateKey(new Date(serializedTaskDate)),
      "2026-07-28"
    );
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test("Time Block times require canonical HH:mm values", () => {
  for (const startTime of [
    undefined,
    null,
    905,
    "9:05",
    "24:00",
    "09:60",
    "09:05:00"
  ]) {
    expectTimeBlockError(
      () => parseDraft({ ...validDraft, startTime }),
      "startTime"
    );
  }
  for (const endTime of ["9:35", "24:00", "10:60", false]) {
    expectTimeBlockError(
      () => parseDraft({ ...validDraft, endTime }),
      "endTime"
    );
  }
});

test("Time Blocks must end later on the same day", () => {
  for (const [startTime, endTime] of [
    ["10:00", "10:00"],
    ["10:01", "10:00"],
    ["23:30", "00:30"]
  ]) {
    expectTimeBlockError(
      () =>
        parseDraft({
          ...validDraft,
          startTime,
          endTime
        }),
      "endTime"
    );
  }
});

test("Time Block titles are trimmed, required, and bounded", () => {
  for (const title of [undefined, null, 42, "", " \n "]) {
    expectTimeBlockError(
      () => parseDraft({ ...validDraft, title }),
      "title"
    );
  }
  expectTimeBlockError(
    () =>
      parseDraft({
        ...validDraft,
        title: "x".repeat(TIME_BLOCK_TITLE_MAX_LENGTH + 1)
      }),
    "title"
  );
  assert.equal(
    parseDraft({
      ...validDraft,
      title: "x".repeat(TIME_BLOCK_TITLE_MAX_LENGTH)
    }).title.length,
    TIME_BLOCK_TITLE_MAX_LENGTH
  );
});

test("Time Block Task identifiers are trimmed and bounded", () => {
  for (const taskId of [
    42,
    false,
    " ",
    "task\u0000id",
    "x".repeat(TIME_BLOCK_TASK_ID_MAX_LENGTH + 1)
  ]) {
    expectTimeBlockError(
      () => parseDraft({ ...validDraft, taskId }),
      "taskId"
    );
  }
});

test("Time Block identifiers reject empty, control, and oversized values", () => {
  assert.equal(parseTimeBlockPathId(" block-1 "), "block-1");
  for (const id of [
    undefined,
    null,
    "",
    " ",
    "block\u007fid",
    "x".repeat(TIME_BLOCK_ID_MAX_LENGTH + 1)
  ]) {
    expectTimeBlockError(() => parseTimeBlockPathId(id), "id");
  }
});

test("malformed and non-object mutation bodies produce typed errors", async () => {
  await assert.rejects(
    () =>
      readTimeBlockMutationBody({
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof TimeBlockError);
      assert.equal(error.code, "INVALID_JSON");
      assert.equal(error.field, "body");
      return true;
    }
  );

  for (const body of [null, [], "text"]) {
    await assert.rejects(
      () => readTimeBlockMutationBody({ json: async () => body }),
      (error: unknown) => {
        assert.ok(error instanceof TimeBlockError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.field, "body");
        return true;
      }
    );
  }
});

test("minute helpers preserve strict wall-clock intervals", () => {
  assert.equal(timeBlockTimeToMinutes("00:00"), 0);
  assert.equal(timeBlockTimeToMinutes("09:05"), 545);
  assert.equal(timeBlockTimeToMinutes("23:59"), 1439);
  assert.equal(minutesToTimeBlockTime(0), "00:00");
  assert.equal(minutesToTimeBlockTime(545), "09:05");
  assert.equal(minutesToTimeBlockTime(1439), "23:59");
  assert.deepEqual(
    timeBlockIntervalToMinutes({
      startTime: "09:05",
      endTime: "10:35"
    }),
    { startMinutes: 545, endMinutes: 635 }
  );
  assert.equal(
    timeBlockDurationMinutes({
      startTime: "09:05",
      endTime: "10:35"
    }),
    90
  );

  for (const minutes of [-1, 1.5, 1440, Number.NaN]) {
    expectTimeBlockError(() => minutesToTimeBlockTime(minutes), "time");
  }
});

test("overlap uses half-open intervals so touching endpoints remain available", () => {
  assert.equal(
    minuteIntervalsOverlap(
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 599, endMinutes: 660 }
    ),
    true
  );
  assert.equal(
    minuteIntervalsOverlap(
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 600, endMinutes: 660 }
    ),
    false
  );
  assert.equal(
    timeBlockIntervalsOverlap(
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "08:30", endTime: "09:00" }
    ),
    false
  );
  assert.equal(
    timeBlockIntervalsOverlap(
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "09:15", endTime: "09:30" }
    ),
    true
  );
});

test("canonical Time Block records reject malformed success and restored data", () => {
  const record = {
    id: "block-1",
    date: "2026-07-28",
    startTime: "09:00",
    endTime: "10:00",
    title: "Canonical plan",
    taskId: "task-1",
    createdAt: "2026-07-28T14:00:00.000Z",
    task: {
      id: "task-1",
      title: "Canonical Task",
      estimateMinutes: 60
    }
  };
  assert.equal(isTimeBlockRecord(record), true);

  for (const candidate of [
    { ...record, id: "" },
    { ...record, date: "2026-07-28-garbage" },
    { ...record, startTime: "9:00" },
    { ...record, endTime: "09:00" },
    { ...record, title: " Canonical plan" },
    { ...record, createdAt: "not-a-date" },
    { ...record, task: null },
    { ...record, task: { ...record.task, id: "task-2" } }
  ]) {
    assert.equal(isTimeBlockRecord(candidate), false);
  }
});
