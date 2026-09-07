import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as getDay } from "../../src/app/api/day/route";
import { getPrisma } from "../../src/lib/prisma";
const prisma = getPrisma();

test("Day route pins its validation envelope", async () => {
  const response = await getDay(
    new NextRequest("http://localhost/api/day?date=2026-02-30")
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "That day is not a real calendar date.",
    code: "VALIDATION_ERROR",
    field: "date"
  });
});

test("Day route pins its internal envelope", async () => {
  const originalTask = prisma.task.findFirst;
  const originalActivity = prisma.activityEntry.findFirst;
  const originalBlock = prisma.timeBlock.findFirst;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma.task as unknown as { findFirst: unknown }).findFirst = async () => {
      throw new Error("unexpected");
    };
    (prisma.activityEntry as unknown as { findFirst: unknown }).findFirst =
      async () => null;
    (prisma.timeBlock as unknown as { findFirst: unknown }).findFirst =
      async () => null;
    const response = await getDay(
      new NextRequest("http://localhost/api/day")
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "That day could not be read.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma.task as unknown as { findFirst: unknown }).findFirst = originalTask;
    (prisma.activityEntry as unknown as { findFirst: unknown }).findFirst =
      originalActivity;
    (prisma.timeBlock as unknown as { findFirst: unknown }).findFirst =
      originalBlock;
    console.error = originalConsoleError;
  }
});
