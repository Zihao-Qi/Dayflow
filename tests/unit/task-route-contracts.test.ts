import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as createTask } from "../../src/app/api/tasks/route";
import {
  DELETE as deleteTask,
  PATCH as updateTask
} from "../../src/app/api/tasks/[id]/route";

test("Task create and patch return typed malformed-JSON responses", async () => {
  const createResponse = await createTask(
    invalidJsonRequest("http://localhost/api/tasks", "POST")
  );
  assert.equal(createResponse.status, 400);
  assert.deepEqual(await createResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const patchResponse = await updateTask(
    invalidJsonRequest("http://localhost/api/tasks/task-id", "PATCH"),
    params("task-id")
  );
  assert.equal(patchResponse.status, 400);
  assert.deepEqual(await patchResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });
});

test("Task create and patch expose typed validation fields", async () => {
  const createResponse = await createTask(
    jsonRequest("http://localhost/api/tasks", "POST", {
      title: "Task",
      estimateMinutes: -1
    })
  );
  assert.equal(createResponse.status, 400);
  assert.deepEqual(await createResponse.json(), {
    error: "Estimate must be a whole number from 0 to 1440 minutes.",
    code: "VALIDATION_ERROR",
    field: "estimateMinutes"
  });

  const patchResponse = await updateTask(
    jsonRequest("http://localhost/api/tasks/task-id", "PATCH", {
      status: "UNKNOWN"
    }),
    params("task-id")
  );
  assert.equal(patchResponse.status, 400);
  assert.deepEqual(await patchResponse.json(), {
    error: "Task status is invalid.",
    code: "VALIDATION_ERROR",
    field: "status"
  });
});

test("Task routes validate mutation and path identifiers before writing", async () => {
  const createResponse = await createTask(
    jsonRequest(
      "http://localhost/api/tasks",
      "POST",
      { title: "Task" },
      { "X-Dayflow-Mutation-Id": " " }
    )
  );
  assert.equal(createResponse.status, 400);
  assert.deepEqual(await createResponse.json(), {
    error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
    code: "INVALID_MUTATION_ID"
  });

  const patchResponse = await updateTask(
    jsonRequest("http://localhost/api/tasks/invalid", "PATCH", {
      title: "Task"
    }),
    params("")
  );
  assert.equal(patchResponse.status, 400);
  assert.deepEqual(await patchResponse.json(), {
    error: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const deleteResponse = await deleteTask(
    new NextRequest("http://localhost/api/tasks/invalid", {
      method: "DELETE"
    }),
    params("")
  );
  assert.equal(deleteResponse.status, 400);
  assert.deepEqual(await deleteResponse.json(), {
    error: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });
});

function invalidJsonRequest(url: string, method: "POST" | "PATCH") {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
}

function jsonRequest(
  url: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
