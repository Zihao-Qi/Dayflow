import assert from "node:assert/strict";
import test from "node:test";
import {
  has,
  parseBoundedInteger,
  parseBoundedString,
  parseEnum,
  parseNullableLocalDate,
  parseRecordId,
  readJsonBody,
  requireObject
} from "../../src/shared/kernel/parsing";
import { parseLocalDate } from "../../src/lib/dates";
import { parseTaskCreateMutation, parseTaskPatchMutation } from "../../src/lib/task-mutations";
import { parseProjectCreateMutation } from "../../src/lib/project-mutations";
import {
  parseActivityCreateMutation,
  parseActivityReplaceMutation,
  parseDiaryUpsertMutation
} from "../../src/lib/evidence-mutations";
import { parseNoteCreateInput, parseMaterialCreateInput } from "../../src/lib/journal-domain";
import { parseReviewMutation } from "../../src/lib/review-domain";
import { parseFocusSessionTransitionMutation } from "../../src/lib/workflow-mutations";

class BoundaryError extends Error {
  constructor(message: string, readonly field: string, readonly code = "CUSTOM") {
    super(message);
  }
}
const error = (message: string, field: string) => new BoundaryError(message, field);
const fails = (action: () => unknown, message: string, field = "field") =>
  assert.throws(action, (caught: unknown) => {
    assert.ok(caught instanceof BoundaryError);
    assert.equal(caught.message, message);
    assert.equal(caught.field, field);
    assert.equal(caught.code, "CUSTOM");
    return true;
  });

test("requireObject preserves object identity without requiring a plain prototype", () => {
  for (const value of [{}, Object.create(null), new Date(0), new String("x")]) {
    assert.equal(requireObject(value, "body", "object only", error), value);
  }
});

test("requireObject uses the caller's exact error for non-objects", () => {
  for (const value of [null, undefined, [], "{}", 0, false, () => ({})]) {
    fails(() => requireObject(value, "body", "object only", error), "object only", "body");
  }
});

test("has distinguishes omitted, inherited, and explicitly undefined properties", () => {
  const object = Object.assign(Object.create({ inherited: 1 }), {
    present: undefined,
    hasOwnProperty: false
  });
  assert.equal(has(object, "present"), true);
  assert.equal(has(object, "inherited"), false);
  assert.equal(has(object, "missing"), false);
  assert.equal(has(Object.assign(Object.create(null), { field: null }), "field"), true);
});

test("parseEnum is exact unless the caller supplies normalization", () => {
  const values = ["ACTIVE", "PAUSED"] as const;
  const result: "ACTIVE" | "PAUSED" = parseEnum("ACTIVE", values, "field", "enum", error);
  assert.equal(result, "ACTIVE");
  for (const value of [" active ", "", null, undefined, 1, new String("ACTIVE")]) {
    fails(() => parseEnum(value, values, "field", "enum", error), "enum");
  }
  assert.equal(parseEnum(" active ", values, "field", "enum", error, {
    normalize: (value) => value.trim().toUpperCase()
  }), "ACTIVE");
});

test("parseEnum preserves separate type and membership messages", () => {
  const options = {
    typeMessage: "must be text",
    normalize: (value: string) => value.trim().toLowerCase()
  };
  fails(() => parseEnum(1, ["website"], "field", "unsupported", error, options), "must be text");
  fails(() => parseEnum("other", ["website"], "field", "unsupported", error, options), "unsupported");
  assert.equal(parseEnum(" WEBSITE ", ["website"], "field", "unsupported", error, options), "website");
});

test("parseBoundedInteger preserves inclusive caller bounds and rejects coercion", () => {
  for (const [minimum, maximum] of [[0, 1440], [1, 5], [1, 240], [1, 10000],
    [1, 10080], [0, 2147483647], [1, 168], [1, 50], [0, 1439]]) {
    for (const value of [minimum, maximum]) {
      assert.equal(parseBoundedInteger(value, "field", minimum, maximum, "integer", error), value);
    }
    for (const value of [minimum - 1, maximum + 1, 1.5, "1", true, null, undefined,
      NaN, Infinity, -Infinity, new Number(1)]) {
      fails(() => parseBoundedInteger(value, "field", minimum, maximum, "integer", error), "integer");
    }
  }
});

test("parseBoundedInteger does not introduce a safe-integer restriction", () => {
  const value = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(parseBoundedInteger(value, "field", 0, value, "integer", error), value);
  assert.ok(Object.is(parseBoundedInteger(-0, "field", 0, 10, "integer", error), -0));
});

const stringOptions = {
  maximumLength: 3,
  lengthMessage: "at most three",
  emptyMessage: "required",
  trim: true
};

test("parseBoundedString distinguishes wrong type, empty text, and excessive length", () => {
  for (const value of [undefined, null, 1, new String("a")]) {
    fails(() => parseBoundedString(value, "field", "text only", error, stringOptions), "text only");
  }
  for (const value of ["", " \t\n"]) {
    fails(() => parseBoundedString(value, "field", "text only", error, stringOptions), "required");
  }
  assert.equal(parseBoundedString(" abc ", "field", "text only", error, stringOptions), "abc");
  fails(() => parseBoundedString("abcd", "field", "text only", error, stringOptions), "at most three");
});

test("parseBoundedString can preserve raw whitespace and allow empty text", () => {
  const options = { maximumLength: 3, lengthMessage: "too long", trim: false };
  for (const value of ["", " a ", "\n", "a\u0000b"]) {
    assert.equal(parseBoundedString(value, "field", "text only", error, options), value);
  }
  fails(() => parseBoundedString(" abc ", "field", "text only", error, options), "too long");
  // Length remains JavaScript UTF-16 length, not code points.
  fails(() => parseBoundedString("😀😀", "field", "text only", error, options), "too long");
});

const strictId = { maximumLength: 191, rejectControlCharacters: true };

test("parseRecordId preserves path trimming, 191-character limits and control checks", () => {
  assert.equal(parseRecordId(" \tid-1\n ", "field", "id", error, strictId), "id-1");
  assert.equal(parseRecordId("x".repeat(191), "field", "id", error, strictId).length, 191);
  for (const value of [null, undefined, "", " ", 1, "x".repeat(192), "a\u0000b", "a\u001fb", "a\u007fb"]) {
    fails(() => parseRecordId(value, "field", "id", error, strictId), "id");
  }
  assert.equal(parseRecordId("a\u0080b", "field", "id", error, strictId), "a\u0080b");
});

test("parseRecordId distinguishes raw empty sentinels from whitespace and undefined", () => {
  const optional = { ...strictId, nullValues: [null, ""] as const };
  assert.equal(parseRecordId("", "field", "id", error, optional), null);
  assert.equal(parseRecordId(null, "field", "id", error, optional), null);
  fails(() => parseRecordId(undefined, "field", "id", error, optional), "id");
  fails(() => parseRecordId(" ", "field", "id", error, optional), "id");
  assert.equal(parseRecordId(undefined, "field", "id", error, {
    ...optional, nullValues: [undefined, null, ""]
  }), null);
  fails(() => parseRecordId("", "field", "id", error, {
    ...strictId, nullValues: [null]
  }), "id");
});

test("parseRecordId supports task and journal relationship policies without tightening them", () => {
  const task = {
    maximumLength: 200, rejectControlCharacters: false,
    nullValues: [null, ""] as const, blankAsNull: true
  };
  assert.equal(parseRecordId(" ", "field", "id", error, task), null);
  assert.equal(parseRecordId("x".repeat(200), "field", "id", error, task)?.length, 200);
  assert.equal(parseRecordId("a\u0000b", "field", "id", error, task), "a\u0000b");
  fails(() => parseRecordId("x".repeat(201), "field", "id", error, task), "id");
  const journal = { ...strictId, rejectControlCharacters: false, typeMessage: "text id" };
  assert.equal(parseRecordId("a\u0000b", "field", "id", error, journal), "a\u0000b");
  fails(() => parseRecordId(1, "field", "id", error, journal), "text id");
  fails(() => parseRecordId(" ", "field", "id", error, journal), "id");
});

const dateOptions = { nullValues: [null, ""] as const, trim: true, parseDate: parseLocalDate };

test("parseNullableLocalDate applies raw sentinel and whitespace policies before calendar parsing", () => {
  for (const value of [null, ""]) {
    assert.equal(parseNullableLocalDate(value, "field", "date", error, dateOptions), null);
  }
  for (const value of [undefined, " ", 1]) {
    fails(() => parseNullableLocalDate(value, "field", "date", error, dateOptions), "date");
  }
  assert.equal(parseNullableLocalDate(undefined, "field", "date", error, {
    ...dateOptions, nullValues: [undefined]
  }), null);
  assert.deepEqual(parseNullableLocalDate(" 2026-09-04 ", "field", "date", error, dateOptions),
    new Date(2026, 8, 4));
  fails(() => parseNullableLocalDate(" 2026-09-04 ", "field", "date", error, {
    ...dateOptions, trim: false
  }), "date");
});

test("parseNullableLocalDate retains leap-day validation and optional ISO-instant support", () => {
  assert.deepEqual(parseNullableLocalDate("2024-02-29", "field", "date", error, dateOptions),
    new Date(2024, 1, 29));
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "0099-01-01"]) {
    fails(() => parseNullableLocalDate(value, "field", "date", error, dateOptions), "date");
  }
  const instant = "2026-09-04T01:00:00.000Z";
  const midnight = new Date(instant);
  midnight.setHours(0, 0, 0, 0);
  assert.deepEqual(parseNullableLocalDate(instant, "field", "date", error, dateOptions), midnight);
  for (const value of [instant, " 2026-09-04", "", null, undefined]) {
    fails(() => parseNullableLocalDate(value, "field", "date", error, {
      ...dateOptions, nullValues: [], dateOnly: true, trim: false
    }), "date");
  }
});

test("parseNullableLocalDate delegates calendar interpretation and preserves its result", () => {
  const expected = new Date(2026, 8, 4);
  let supplied: string | undefined;
  assert.equal(parseNullableLocalDate(" day ", "field", "date", error, {
    nullValues: [], trim: true,
    parseDate: (value) => { supplied = value; return expected; }
  }), expected);
  assert.equal(supplied, "day");
});

test("readJsonBody preserves its receiver and returns any decoded JSON unchanged", async () => {
  for (const value of [{ a: 1 }, null, [], "text", 1]) {
    const request = {
      value,
      async json() { return this.value; }
    };
    assert.equal(await readJsonBody(request, "body", "json", error), value);
  }
});

test("readJsonBody translates synchronous and asynchronous read failures with the caller factory", async () => {
  for (const json of [
    () => { throw new Error("sync"); },
    async () => { throw new Error("async"); }
  ]) {
    const expected = new BoundaryError("exact JSON message", "payload", "INVALID_JSON");
    await assert.rejects(readJsonBody({ json }, "payload", "exact JSON message", (message, field) => {
      assert.equal(message, expected.message);
      assert.equal(field, expected.field);
      return expected;
    }), (caught: unknown) => caught === expected);
  }
});

test("body shape failures after readJsonBody retain the validation error", async () => {
  await assert.rejects(async () => {
    const body = await readJsonBody({ json: async () => [] }, "body", "json", error);
    return requireObject(body, "body", "object", (message, field) =>
      new BoundaryError(message, field, "VALIDATION_ERROR"));
  }, { message: "object", field: "body", code: "VALIDATION_ERROR" });
});

const now = new Date(2026, 8, 4, 12);
const activity = { durationMinutes: 25, note: "Evidence" };

test("boundary wrappers retain their conflicting relationship-ID policies", () => {
  assert.equal(parseTaskCreateMutation({ title: "Task", projectId: " " }, now).projectId, null);
  assert.equal(parseTaskCreateMutation({ title: "Task", projectId: "x".repeat(200) }, now).projectId?.length, 200);
  assert.equal(parseNoteCreateInput({ content: "Note", taskId: "a\u0000b" }, now).taskId, "a\u0000b");
  for (const taskId of [" ", "a\u0000b", "x".repeat(192)]) {
    assert.throws(() => parseActivityCreateMutation({ ...activity, taskId }, now),
      { message: "Task identifier is invalid.", field: "taskId", code: "VALIDATION_ERROR" });
  }
  assert.equal(parseActivityCreateMutation({ ...activity, taskId: "" }, now).taskId, null);
  assert.throws(() => parseActivityReplaceMutation({
    ...activity, startTime: "09:00", category: "Work", taskId: "", projectId: null
  }), { message: "Task identifier is invalid.", field: "taskId" });
  assert.throws(() => parseNoteCreateInput({ content: "Note", taskId: 1 }, now),
    { message: "Task identifier must be text.", code: "VALIDATION_ERROR" });
});

test("boundary wrappers preserve text defaults, whitespace and exact length-message formatting", () => {
  assert.equal(parseDiaryUpsertMutation({ content: " Note " }, now).content, " Note ");
  assert.equal(parseNoteCreateInput({ content: " Note " }, now).content, "Note");
  assert.equal(parseProjectCreateMutation({ name: "P", desiredOutcome: null }).desiredOutcome, "");
  assert.equal(parseFocusSessionTransitionMutation({ action: "pause", note: null }).note, undefined);
  const review = {
    periodStart: new Date(2026, 7, 1).toISOString(),
    periodEnd: new Date(2026, 7, 8).toISOString(),
    narrative: "Review"
  };
  assert.throws(() => parseReviewMutation({ ...review, nextPeriodIntention: null }),
    { message: "Next-period intention must be text.", field: "nextPeriodIntention" });
  assert.throws(() => parseProjectCreateMutation({ name: "P", desiredOutcome: "x".repeat(5001) }),
    { message: "Desired outcome must be 5000 characters or fewer." });
  assert.throws(() => parseActivityCreateMutation({ ...activity, note: "x".repeat(5001) }, now),
    { message: "Activity note must be 5,000 characters or fewer." });
  const patch = parseTaskPatchMutation({ date: null, scheduleSource: " manual " },
    { projectId: null, phaseId: null, status: "TODO" }, now);
  assert.equal(patch.scheduleSource, " manual ");
});

test("boundary wrappers retain date defaults and enum normalization differences", () => {
  assert.equal(parseTaskCreateMutation({ title: "T", date: "" }, now).date, null);
  assert.throws(() => parseTaskCreateMutation({ title: "T", date: undefined }, now),
    { message: "Scheduled date is invalid.", field: "date" });
  assert.deepEqual(parseDiaryUpsertMutation({ date: "" }, now).date, new Date(2026, 8, 4));
  assert.throws(() => parseActivityCreateMutation({ ...activity, date: "" }, now),
    { message: "Activity date is invalid.", field: "date" });
  assert.throws(() => parseNoteCreateInput({ content: "Note", date: " 2026-09-04 " }, now),
    { message: "Note date is invalid." });
  assert.equal(parseProjectCreateMutation({ name: "P", status: " paused " }).status, "PAUSED");
  assert.throws(() => parseTaskCreateMutation({ title: "T", status: " todo " }, now),
    { message: "Task status is invalid." });
  assert.equal(parseMaterialCreateInput({ url: "https://example.com", type: " PDF " }).type, "pdf");
});
