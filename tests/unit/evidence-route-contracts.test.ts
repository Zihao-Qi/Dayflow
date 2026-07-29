import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as createActivity } from "../../src/app/api/activities/route";
import { PUT as updateActivity } from "../../src/app/api/activities/[id]/route";
import { PUT as saveDiary } from "../../src/app/api/diary/route";
import { POST as createMaterial } from "../../src/app/api/materials/route";
import { POST as createNote } from "../../src/app/api/notes/route";

test("evidence routes return typed malformed-JSON responses", async () => {
  const activityResponse = await createActivity(
    invalidJsonRequest("http://localhost/api/activities", "POST")
  );
  assert.equal(activityResponse.status, 400);
  assert.deepEqual(await activityResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  for (const [route, url] of [
    [createNote, "http://localhost/api/notes"],
    [createMaterial, "http://localhost/api/materials"]
  ] as const) {
    const response = await route(invalidJsonRequest(url, "POST"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request body must be valid JSON.",
      code: "INVALID_JSON"
    });
  }

  const diaryResponse = await saveDiary(
    invalidJsonRequest("http://localhost/api/diary", "PUT")
  );
  assert.equal(diaryResponse.status, 400);
  assert.deepEqual(await diaryResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });
});

test("evidence routes expose typed validation errors", async () => {
  const activityResponse = await createActivity(
    jsonRequest("http://localhost/api/activities", "POST", {
      durationMinutes: -1,
      note: "Invalid duration"
    })
  );
  assert.equal(activityResponse.status, 400);
  assert.deepEqual(await activityResponse.json(), {
    error: "Duration must be between 1 and 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "durationMinutes"
  });

  const diaryResponse = await saveDiary(
    jsonRequest("http://localhost/api/diary", "PUT", {
      date: "2026-02-30"
    })
  );
  assert.equal(diaryResponse.status, 400);
  assert.deepEqual(await diaryResponse.json(), {
    error: "Diary date must be a valid calendar date.",
    code: "VALIDATION_ERROR",
    field: "date"
  });

  const noteResponse = await createNote(
    jsonRequest("http://localhost/api/notes", "POST", { content: "" })
  );
  assert.equal(noteResponse.status, 400);
  assert.deepEqual(await noteResponse.json(), {
    error: "Write something before saving this note.",
    code: "VALIDATION_ERROR"
  });

  const materialResponse = await createMaterial(
    jsonRequest("http://localhost/api/materials", "POST", { url: "" })
  );
  assert.equal(materialResponse.status, 400);
  assert.deepEqual(await materialResponse.json(), {
    error: "Add a URL before saving this reference.",
    code: "VALIDATION_ERROR"
  });
});

test("Activity replacement route validates the path and full body before writing", async () => {
  const invalidIdResponse = await updateActivity(
    jsonRequest("http://localhost/api/activities/invalid", "PUT", {}),
    { params: Promise.resolve({ id: " " }) }
  );
  assert.equal(invalidIdResponse.status, 400);
  assert.deepEqual(await invalidIdResponse.json(), {
    error: "Activity identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const invalidJsonResponse = await updateActivity(
    invalidJsonRequest("http://localhost/api/activities/activity-1", "PUT"),
    { params: Promise.resolve({ id: "activity-1" }) }
  );
  assert.equal(invalidJsonResponse.status, 400);
  assert.deepEqual(await invalidJsonResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const partialBodyResponse = await updateActivity(
    jsonRequest("http://localhost/api/activities/activity-1", "PUT", {
      startTime: "09:05",
      durationMinutes: 25,
      category: "Deep Work",
      note: "Corrected Activity evidence."
    }),
    { params: Promise.resolve({ id: "activity-1" }) }
  );
  assert.equal(partialBodyResponse.status, 400);
  assert.deepEqual(await partialBodyResponse.json(), {
    error: "Task relationship is required.",
    code: "VALIDATION_ERROR",
    field: "taskId"
  });
});

test("Note and Material routes validate mutation identifiers before writing", async () => {
  for (const [route, url, body] of [
    [createNote, "http://localhost/api/notes", { content: "Note" }],
    [
      createMaterial,
      "http://localhost/api/materials",
      { url: "https://example.com" }
    ]
  ] as const) {
    const response = await route(
      jsonRequest(url, "POST", body, {
        "X-Dayflow-Mutation-Id": " "
      })
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
      code: "INVALID_MUTATION_ID"
    });
  }
});

function invalidJsonRequest(url: string, method: "POST" | "PUT") {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
}

function jsonRequest(
  url: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}
