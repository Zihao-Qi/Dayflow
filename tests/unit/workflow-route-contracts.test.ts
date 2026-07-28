import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { DELETE as deleteActivity } from "../../src/app/api/activities/[id]/route";
import {
  DELETE as removeFocusQueueTask,
  PATCH as reorderFocusQueue,
  POST as addFocusQueueTask
} from "../../src/app/api/focus-queue/route";
import { PATCH as transitionFocusSession } from "../../src/app/api/focus-session/[id]/route";
import { POST as startFocusSession } from "../../src/app/api/focus-session/route";
import { POST as undoTaskSchedule } from "../../src/app/api/tasks/[id]/schedule/undo/route";
import { POST as reorderTasks } from "../../src/app/api/tasks/reorder/route";

test("workflow mutation routes return typed malformed-JSON responses", async () => {
  for (const [route, request] of [
    [
      addFocusQueueTask,
      invalidJsonRequest("http://localhost/api/focus-queue", "POST")
    ],
    [
      reorderFocusQueue,
      invalidJsonRequest("http://localhost/api/focus-queue", "PATCH")
    ],
    [
      removeFocusQueueTask,
      invalidJsonRequest("http://localhost/api/focus-queue", "DELETE")
    ],
    [
      startFocusSession,
      invalidJsonRequest("http://localhost/api/focus-session", "POST")
    ],
    [
      reorderTasks,
      invalidJsonRequest("http://localhost/api/tasks/reorder", "POST")
    ]
  ] as const) {
    const response = await route(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request body must be valid JSON.",
      code: "INVALID_JSON",
      field: "body"
    });
  }

  const transitionResponse = await transitionFocusSession(
    invalidJsonRequest("http://localhost/api/focus-session/session-1", "PATCH"),
    { params: Promise.resolve({ id: "session-1" }) }
  );
  assert.equal(transitionResponse.status, 400);
  assert.deepEqual(await transitionResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });
});

test("workflow routes expose typed validation fields before persistence", async () => {
  const queue = await addFocusQueueTask(
    jsonRequest("http://localhost/api/focus-queue", "POST", {
      taskId: "task-1",
      placement: "sideways"
    })
  );
  assert.equal(queue.status, 400);
  assert.deepEqual(await queue.json(), {
    error: "Queue placement must be next or end.",
    code: "VALIDATION_ERROR",
    field: "placement"
  });

  const start = await startFocusSession(
    jsonRequest("http://localhost/api/focus-session", "POST", {
      kind: "FOCUS",
      plannedMinutes: "25"
    })
  );
  assert.equal(start.status, 400);
  assert.deepEqual(await start.json(), {
    error: "Timer duration must be between 1 and 240 minutes.",
    code: "VALIDATION_ERROR",
    field: "plannedMinutes"
  });

  const transition = await transitionFocusSession(
    jsonRequest(
      "http://localhost/api/focus-session/session-1",
      "PATCH",
      { action: "restart" }
    ),
    { params: Promise.resolve({ id: "session-1" }) }
  );
  assert.equal(transition.status, 400);
  assert.deepEqual(await transition.json(), {
    error: "Unknown timer action.",
    code: "VALIDATION_ERROR",
    field: "action"
  });

  const reorder = await reorderTasks(
    jsonRequest("http://localhost/api/tasks/reorder", "POST", {
      ids: ["task-1", "task-1"]
    })
  );
  assert.equal(reorder.status, 400);
  assert.deepEqual(await reorder.json(), {
    error: "Task identifiers must not contain duplicates.",
    code: "VALIDATION_ERROR",
    field: "ids"
  });
});

test("path-based workflow routes reject invalid identifiers before querying", async () => {
  const request = new NextRequest("http://localhost/api/resource", {
    method: "DELETE"
  });
  const activity = await deleteActivity(request, {
    params: Promise.resolve({ id: "" })
  });
  assert.equal(activity.status, 400);
  assert.deepEqual(await activity.json(), {
    error: "Activity identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const undo = await undoTaskSchedule(
    new NextRequest("http://localhost/api/tasks/task/schedule/undo", {
      method: "POST"
    }),
    { params: Promise.resolve({ id: "" }) }
  );
  assert.equal(undo.status, 400);
  assert.deepEqual(await undo.json(), {
    error: "Task identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const transition = await transitionFocusSession(
    jsonRequest("http://localhost/api/focus-session/session", "PATCH", {
      action: "pause"
    }),
    { params: Promise.resolve({ id: "" }) }
  );
  assert.equal(transition.status, 400);
  assert.deepEqual(await transition.json(), {
    error: "Focus session identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });
});

function invalidJsonRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE"
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
}

function jsonRequest(
  url: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
