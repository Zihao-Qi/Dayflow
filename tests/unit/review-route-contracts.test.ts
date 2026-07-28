import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PUT as saveReview } from "../../src/app/api/review/route";

test("Review route returns typed malformed and empty mutation errors", async () => {
  const malformed = await saveReview(
    new NextRequest("http://localhost/api/review", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{"
    })
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const empty = await saveReview(
    jsonRequest({
      periodStart: "2020-01-01T06:00:00.000Z",
      periodEnd: "2020-01-08T06:00:00.000Z",
      narrative: " ",
      nextPeriodIntention: ""
    })
  );
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), {
    error: "Write a narrative or next-period intention before saving this Review.",
    code: "VALIDATION_ERROR",
    field: "review"
  });
});

test("Review route rejects a stale exact period before persistence", async () => {
  const response = await saveReview(
    jsonRequest({
      periodStart: "2020-01-01T06:00:00.000Z",
      periodEnd: "2020-01-08T06:00:00.000Z",
      narrative: "Evidence from an earlier period"
    })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The Review Period changed. Refresh and try again.",
    code: "REVIEW_PERIOD_CHANGED",
    field: "reviewPeriod"
  });
});

function jsonRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/review", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
