import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_HISTORY_MAX_LIMIT,
  ReviewHistoryRequestError,
  decodeReviewCursor,
  encodeReviewCursor,
  isReviewIdentifier,
  parseReviewHistoryPage,
  parseReviewWindowRequest
} from "../../src/lib/review-history";
import { localDateKey } from "../../src/lib/dates";

const params = (query: string) => new URLSearchParams(query);

function rejection(query: string) {
  try {
    parseReviewHistoryPage(params(query));
  } catch (error) {
    assert.ok(error instanceof ReviewHistoryRequestError);
    return error;
  }
  throw new assert.AssertionError({
    message: `expected "${query}" to be rejected`
  });
}

test("Review history defaults to a bounded first page", () => {
  const page = parseReviewHistoryPage(params(""));
  assert.equal(page.cursor, null);
  assert.ok(page.limit >= 1 && page.limit <= REVIEW_HISTORY_MAX_LIMIT);
});

test("Review history rejects malformed page limits with typed errors", () => {
  for (const query of [
    "limit=0",
    "limit=-1",
    "limit=1.5",
    "limit=abc",
    "limit=",
    `limit=${REVIEW_HISTORY_MAX_LIMIT + 1}`,
    "limit=10&limit=20"
  ]) {
    const error = rejection(query);
    assert.equal(error.code, "VALIDATION_ERROR", query);
    assert.equal(error.status, 400, query);
  }
});

test("Review history rejects malformed and duplicated cursors with typed errors", () => {
  for (const query of [
    "cursor=",
    "cursor=not*base64",
    `cursor=${Buffer.from("{").toString("base64url")}`,
    `cursor=${Buffer.from(
      JSON.stringify({ version: 2, kind: "review", periodStart: "x", id: "a" })
    ).toString("base64url")}`,
    `cursor=${Buffer.from(
      JSON.stringify({ version: 1, kind: "note", periodStart: "x", id: "a" })
    ).toString("base64url")}`,
    `cursor=${Buffer.from(
      JSON.stringify({
        version: 1,
        kind: "review",
        periodStart: "not-a-date",
        id: "a"
      })
    ).toString("base64url")}`,
    "cursor=a&cursor=b"
  ]) {
    const error = rejection(query);
    assert.equal(error.code, "INVALID_CURSOR", query);
    assert.equal(error.status, 400, query);
  }
});

test("Review cursors round trip their exact period boundary and identity", () => {
  const value = {
    periodStart: new Date("2026-08-03T05:00:00.000Z"),
    id: "ckreview000000000000"
  };
  const decoded = decodeReviewCursor(encodeReviewCursor(value));
  assert.equal(decoded.periodStart.getTime(), value.periodStart.getTime());
  assert.equal(decoded.id, value.id);

  const page = parseReviewHistoryPage(
    params(`cursor=${encodeReviewCursor(value)}&limit=5`)
  );
  assert.equal(page.limit, 5);
  assert.equal(page.cursor?.id, value.id);
});

test("Review identifiers reject path and wildcard characters before querying", () => {
  assert.equal(isReviewIdentifier("ckreview000000000000"), true);
  for (const value of ["", "../secrets", "a/b", "a b", "%", "a".repeat(65)]) {
    assert.equal(isReviewIdentifier(value), false, value);
  }
});

test("Review Window anchors resolve seven local calendar days across daylight saving", () => {
  const window = parseReviewWindowRequest(
    params("ending=2026-03-08"),
    new Date(2026, 2, 10, 12)
  );

  assert.equal(window.ending, "2026-03-08");
  assert.equal(localDateKey(window.start), "2026-03-02");
  assert.equal(localDateKey(window.end), "2026-03-09");
  assert.equal(
    (window.end.getTime() - window.start.getTime()) / (60 * 60 * 1_000),
    167,
    "spring daylight saving removes one elapsed hour without removing a local day"
  );
});

test("Review Window anchors are canonical, singular, real, and strictly past", () => {
  const now = new Date(2026, 8, 1, 12);
  for (const query of [
    "",
    "ending=",
    "ending=2026-08-31&ending=2026-08-30",
    "ending=2026-02-30",
    "ending=2026-8-31",
    "ending=%202026-08-31",
    "ending=2026-09-01",
    "ending=2026-09-02"
  ]) {
    assert.throws(
      () => parseReviewWindowRequest(params(query), now),
      (error: unknown) =>
        error instanceof ReviewHistoryRequestError &&
        error.code === "VALIDATION_ERROR" &&
        error.status === 400,
      query
    );
  }
});

test("Review cursors preserve legacy UTF-8 bytes and malformed trailing-sextet behavior without Buffer", () => {
  const value = { periodStart: new Date("2026-08-03T05:00:00.000Z"), id: "review-学习-🌱" };
  const text = JSON.stringify({ version: 1, kind: "review", periodStart: value.periodStart.toISOString(), id: value.id });
  const expected = Buffer.from(text).toString("base64url");
  assert.equal(encodeReviewCursor(value), expected);
  const originalBuffer = globalThis.Buffer;
  try {
    Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true, writable: true });
    assert.equal(encodeReviewCursor(value), expected);
    assert.deepEqual(decodeReviewCursor(expected), value);
  } finally {
    Object.defineProperty(globalThis, "Buffer", { value: originalBuffer, configurable: true, writable: true });
  }
  const divisible = text + " ".repeat((3 - Buffer.byteLength(text) % 3) % 3);
  assert.deepEqual(decodeReviewCursor(Buffer.from(divisible).toString("base64url") + "A"), value);
  assert.throws(() => decodeReviewCursor(Buffer.from("\uFEFF" + text).toString("base64url")), ReviewHistoryRequestError);
});
