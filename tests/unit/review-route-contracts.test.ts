import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PUT as saveReview } from "../../src/app/api/review/route";
import { GET as getPastReview } from "../../src/app/api/review/[id]/route";
import { GET as getReviewHistory } from "../../src/app/api/review/history/route";
import { GET as getReviewWindow } from "../../src/app/api/review/window/route";
import { reviewPeriodRange } from "../../src/lib/dates";
import { prisma } from "../../src/lib/prisma";

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

test("Review read routes pin validation, cursor, and not-found envelopes", async () => {
  const invalidId = await getPastReview(
    new Request("http://localhost/api/review/invalid"),
    { params: Promise.resolve({ id: "../invalid" }) }
  );
  assert.equal(invalidId.status, 400);
  assert.deepEqual(await invalidId.json(), {
    error: "That Review identifier is not valid.",
    code: "VALIDATION_ERROR"
  });

  const originalFindUnique = prisma.review.findUnique;
  try {
    (prisma.review as unknown as { findUnique: unknown }).findUnique = async () =>
      null;
    const missing = await getPastReview(
      new Request("http://localhost/api/review/missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: "That Review no longer exists.",
      code: "REVIEW_NOT_FOUND"
    });
  } finally {
    (prisma.review as unknown as { findUnique: unknown }).findUnique =
      originalFindUnique;
  }

  const history = await getReviewHistory(
    new NextRequest("http://localhost/api/review/history?cursor=invalid!")
  );
  assert.equal(history.status, 400);
  assert.deepEqual(await history.json(), {
    error: "That pagination cursor is no longer usable. Reload Review history.",
    code: "INVALID_CURSOR"
  });

  const window = await getReviewWindow(
    new NextRequest("http://localhost/api/review/window")
  );
  assert.equal(window.status, 400);
  assert.deepEqual(await window.json(), {
    error: "Choose a Review Window ending day.",
    code: "VALIDATION_ERROR"
  });
});

test("Review routes pin operation-specific internal envelopes", async () => {
  const originalUpsert = prisma.review.upsert;
  const originalFindUnique = prisma.review.findUnique;
  const originalFindMany = prisma.review.findMany;
  const originalCount = prisma.review.count;
  const originalActivityFindMany = prisma.activityEntry.findMany;
  const originalDiaryFindMany = prisma.diaryEntry.findMany;
  const originalTaskFindMany = prisma.task.findMany;
  const originalNoteFindMany = prisma.note.findMany;
  const originalMaterialFindMany = prisma.material.findMany;
  const originalProjectFindMany = prisma.project.findMany;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma.review as unknown as { upsert: unknown }).upsert = async () => {
      throw new Error("unexpected");
    };
    const { start: periodStart, end: periodEnd } = reviewPeriodRange();
    const saveFallback = await saveReview(
      jsonRequest({
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        narrative: "Review"
      })
    );
    assert.equal(saveFallback.status, 500);
    assert.deepEqual(await saveFallback.json(), {
      error: "Review could not be saved.",
      code: "INTERNAL_ERROR"
    });

    (prisma.review as unknown as { findUnique: unknown }).findUnique = async () => {
      throw new Error("unexpected");
    };
    const detailFallback = await getPastReview(
      new Request("http://localhost/api/review/review-id"),
      { params: Promise.resolve({ id: "review-id" }) }
    );
    assert.equal(detailFallback.status, 500);
    assert.deepEqual(await detailFallback.json(), {
      error: "Review period could not be read.",
      code: "INTERNAL_ERROR"
    });

    (prisma.review as unknown as { findMany: unknown }).findMany = async () => {
      throw new Error("unexpected");
    };
    (prisma.review as unknown as { count: unknown }).count = async () => 0;
    const historyFallback = await getReviewHistory(
      new NextRequest("http://localhost/api/review/history")
    );
    assert.equal(historyFallback.status, 500);
    assert.deepEqual(await historyFallback.json(), {
      error: "Review history could not be read.",
      code: "INTERNAL_ERROR"
    });

    (prisma.activityEntry as unknown as { findMany: unknown }).findMany =
      async () => {
        throw new Error("unexpected");
      };
    (prisma.diaryEntry as unknown as { findMany: unknown }).findMany =
      async () => [];
    (prisma.task as unknown as { findMany: unknown }).findMany = async () => [];
    (prisma.note as unknown as { findMany: unknown }).findMany = async () => [];
    (prisma.material as unknown as { findMany: unknown }).findMany =
      async () => [];
    (prisma.project as unknown as { findMany: unknown }).findMany =
      async () => [];
    (prisma.review as unknown as { findUnique: unknown }).findUnique =
      async () => null;
    const windowFallback = await getReviewWindow(
      new NextRequest("http://localhost/api/review/window?ending=2020-01-01")
    );
    assert.equal(windowFallback.status, 500);
    assert.deepEqual(await windowFallback.json(), {
      error: "Review Window could not be read.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma.review as unknown as { upsert: unknown }).upsert = originalUpsert;
    (prisma.review as unknown as { findUnique: unknown }).findUnique =
      originalFindUnique;
    (prisma.review as unknown as { findMany: unknown }).findMany =
      originalFindMany;
    (prisma.review as unknown as { count: unknown }).count = originalCount;
    (prisma.activityEntry as unknown as { findMany: unknown }).findMany =
      originalActivityFindMany;
    (prisma.diaryEntry as unknown as { findMany: unknown }).findMany =
      originalDiaryFindMany;
    (prisma.task as unknown as { findMany: unknown }).findMany =
      originalTaskFindMany;
    (prisma.note as unknown as { findMany: unknown }).findMany =
      originalNoteFindMany;
    (prisma.material as unknown as { findMany: unknown }).findMany =
      originalMaterialFindMany;
    (prisma.project as unknown as { findMany: unknown }).findMany =
      originalProjectFindMany;
    console.error = originalConsoleError;
  }
});

function jsonRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/review", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
