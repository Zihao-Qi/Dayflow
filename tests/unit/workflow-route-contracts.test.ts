import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { DELETE as deleteActivity } from "../../src/app/api/activities/[id]/route";
import {
  DELETE as removeFocusQueueTask,
  PATCH as reorderFocusQueue,
  POST as addFocusQueueTask
} from "../../src/app/api/focus-queue/route";
import { PATCH as transitionFocusSession } from "../../src/app/api/focus-session/[id]/route";
import {
  GET as getFocusSnapshot,
  POST as startFocusSession
} from "../../src/app/api/focus-session/route";
import { POST as undoTaskSchedule } from "../../src/app/api/tasks/[id]/schedule/undo/route";
import { POST as reorderTasks } from "../../src/app/api/tasks/reorder/route";
import { FocusSessionError } from "../../src/lib/focus-sessions";
import { FocusQueueError } from "../../src/lib/focus-queue";
import { mutationRequestHash } from "../../src/lib/idempotent-mutations";
import { prisma } from "../../src/lib/prisma";

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

test("Focus start pins active-session, P2002, P2003, not-found, and fallback envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const cases: Array<[
      Record<string, unknown>,
      Record<string, unknown>,
      number,
      Record<string, unknown>
    ]> = [
      [
        {
          focusSession: { findFirst: async () => ({ id: "active" }) }
        },
        { kind: "FOCUS", plannedMinutes: 25 },
        409,
        { error: "Finish or cancel the active timer first.", code: "CONFLICT" }
      ],
      [
        {
          focusSession: { findFirst: async () => null },
          task: { findUnique: async () => null }
        },
        { kind: "FOCUS", plannedMinutes: 25, taskId: "missing" },
        404,
        { error: "The selected task could not be found.", code: "NOT_FOUND" }
      ],
      [
        {
          focusSession: { findFirst: async () => null },
          project: { findUnique: async () => null }
        },
        { kind: "FOCUS", plannedMinutes: 25, projectId: "missing" },
        404,
        { error: "The selected project could not be found.", code: "NOT_FOUND" }
      ],
      [
        {
          focusSession: {
            findFirst: async () => null,
            create: async () => {
              throw prismaError("P2002");
            }
          },
          task: { findUnique: async () => null },
          project: { findUnique: async () => null }
        },
        { kind: "FOCUS", plannedMinutes: 25 },
        409,
        { error: "Finish or cancel the active timer first.", code: "CONFLICT" }
      ],
      [
        {
          focusSession: { findFirst: async () => null },
          task: {
            findUnique: async () => ({
              id: "task-1",
              title: "Task",
              projectId: "project-a"
            })
          }
        },
        {
          kind: "FOCUS",
          plannedMinutes: 25,
          taskId: "task-1",
          projectId: "project-b"
        },
        409,
        {
          error: "The selected task belongs to a different project.",
          code: "CONFLICT"
        }
      ]
    ];
    for (const [transaction, payload, status, body] of cases) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (client: unknown) => unknown
      ) => operation(transaction);
      const response = await startFocusSession(
        jsonRequest("http://localhost/api/focus-session", "POST", payload)
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    const receiptPayload = { kind: "FOCUS", plannedMinutes: 25 };
    const canonicalReceiptPayload = {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: undefined,
      taskId: null,
      projectId: null
    };
    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (client: unknown) => unknown
    ) =>
      operation({
        mutationReceipt: {
          findUnique: async () => ({
            kind: "focus-session.start",
            requestHash: mutationRequestHash(
              "focus-session.start",
              canonicalReceiptPayload
            ),
            responseJson: "{"
          })
        }
      });
    const invalidReceipt = await startFocusSession(
      new NextRequest("http://localhost/api/focus-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dayflow-Mutation-Id": "invalid-focus-receipt"
        },
        body: JSON.stringify(receiptPayload)
      })
    );
    assert.equal(invalidReceipt.status, 500);
    assert.deepEqual(await invalidReceipt.json(), {
      error: "The saved mutation receipt could not be read.",
      code: "INVALID_MUTATION_RECEIPT"
    });

    for (const [error, status, body] of [
      [
        prismaError("P2003"),
        409,
        {
          error: "A selected Focus relationship changed before the timer started.",
          code: "CONFLICT"
        }
      ],
      [
        new Error("unexpected"),
        500,
        { error: "Focus timer could not be started.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response = await startFocusSession(
        jsonRequest("http://localhost/api/focus-session", "POST", {
          kind: "FOCUS",
          plannedMinutes: 25
        })
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Focus snapshot GET pins its internal envelope", async () => {
  const originalFindFirst = prisma.focusSession.findFirst;
  const originalFindMany = prisma.focusSession.findMany;
  const originalAggregate = prisma.activityEntry.aggregate;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma.focusSession as unknown as { findFirst: unknown }).findFirst =
      async () => {
        throw new Error("unexpected");
      };
    (prisma.focusSession as unknown as { findMany: unknown }).findMany =
      async () => [];
    (prisma.activityEntry as unknown as { aggregate: unknown }).aggregate =
      async () => ({ _sum: { durationMinutes: null } });
    const response = await getFocusSnapshot();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Focus timer could not be loaded.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma.focusSession as unknown as { findFirst: unknown }).findFirst =
      originalFindFirst;
    (prisma.focusSession as unknown as { findMany: unknown }).findMany =
      originalFindMany;
    (prisma.activityEntry as unknown as { aggregate: unknown }).aggregate =
      originalAggregate;
    console.error = originalConsoleError;
  }
});

test("Focus transition pins not-found, conflict, Prisma, and fallback envelopes", async () => {
  const originalFindUnique = prisma.focusSession.findUnique;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [value, status, body] of [
      [
        null,
        404,
        { error: "Focus session not found.", code: "NOT_FOUND", field: "id" }
      ],
      [
        {
          id: "session-1",
          status: "COMPLETED",
          kind: "FOCUS",
          pausedAt: null
        },
        409,
        { error: "Only a running timer can be paused.", code: "CONFLICT" }
      ]
    ] as const) {
      (prisma.focusSession as unknown as { findUnique: unknown }).findUnique =
        async () => value;
      const response = await transitionFocusSession(
        jsonRequest("http://localhost/api/focus-session/session-1", "PATCH", {
          action: "pause"
        }),
        { params: Promise.resolve({ id: "session-1" }) }
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    for (const code of ["P2003", "P2025"]) {
      (prisma.focusSession as unknown as { findUnique: unknown }).findUnique =
        async () => {
          throw prismaError(code);
        };
      const response = await transitionFocusSession(
        jsonRequest("http://localhost/api/focus-session/session-1", "PATCH", {
          action: "pause"
        }),
        { params: Promise.resolve({ id: "session-1" }) }
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "The Focus session changed before it could be saved.",
        code: "CONFLICT"
      });
    }

    (prisma.focusSession as unknown as { findUnique: unknown }).findUnique =
      async () => {
        throw new Error("unexpected");
      };
    const fallback = await transitionFocusSession(
      jsonRequest("http://localhost/api/focus-session/session-1", "PATCH", {
        action: "pause"
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );
    assert.equal(fallback.status, 500);
    assert.deepEqual(await fallback.json(), {
      error: "Focus timer could not be saved.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma.focusSession as unknown as { findUnique: unknown }).findUnique =
      originalFindUnique;
    console.error = originalConsoleError;
  }
});

test("Focus queue pins not-found, conflict, and fallback envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [task, status, body] of [
      [
        null,
        404,
        { error: "Task not found.", code: "NOT_FOUND", field: "taskId" }
      ],
      [
        { id: "task-1", status: "DONE" },
        409,
        { error: "Completed tasks cannot be queued.", code: "CONFLICT" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (client: unknown) => unknown
      ) => operation({ task: { findUnique: async () => task } });
      const response = await addFocusQueueTask(
        jsonRequest("http://localhost/api/focus-queue", "POST", {
          taskId: "task-1",
          placement: "end"
        })
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new FocusQueueError("Queue placement must be next or end.");
    };
    const domainValidation = await addFocusQueueTask(
      jsonRequest("http://localhost/api/focus-queue", "POST", {
        taskId: "task-1",
        placement: "end"
      })
    );
    assert.equal(domainValidation.status, 400);
    assert.deepEqual(await domainValidation.json(), {
      error: "Queue placement must be next or end.",
      code: "VALIDATION_ERROR"
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const fallback = await addFocusQueueTask(
      jsonRequest("http://localhost/api/focus-queue", "POST", {
        taskId: "task-1",
        placement: "end"
      })
    );
    assert.equal(fallback.status, 500);
    assert.deepEqual(await fallback.json(), {
      error: "Focus queue could not be saved.",
      code: "INTERNAL_ERROR"
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (client: unknown) => unknown
    ) => operation({
      task: {
        findMany: async () => [{ id: "task-1" }]
      }
    });
    const staleOrder = await reorderFocusQueue(
      jsonRequest("http://localhost/api/focus-queue", "PATCH", {
        ids: ["task-1"],
        expectedIds: ["different-task"]
      })
    );
    assert.equal(staleOrder.status, 409);
    assert.deepEqual(await staleOrder.json(), {
      error: "Queue order is out of date. Refresh and try again.",
      code: "CONFLICT"
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Task reorder and schedule undo pin not-found, Prisma, and fallback envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ task: { findMany: async () => [] } });
    const missingReorder = await reorderTasks(
      jsonRequest("http://localhost/api/tasks/reorder", "POST", {
        ids: ["task-1"]
      })
    );
    assert.equal(missingReorder.status, 404);
    assert.deepEqual(await missingReorder.json(), {
      error: "One or more tasks could not be found.",
      code: "NOT_FOUND",
      field: "ids"
    });

    for (const [error, status, body] of [
      [
        prismaError("P2025"),
        409,
        {
          error: "A task changed before its order could be saved.",
          code: "CONFLICT"
        }
      ],
      [
        new Error("unexpected"),
        500,
        { error: "Task order could not be saved.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response = await reorderTasks(
        jsonRequest("http://localhost/api/tasks/reorder", "POST", {
          ids: ["task-1"]
        })
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    for (const [result, body] of [
      [
        { kind: "task-missing" },
        { error: "Task not found.", code: "NOT_FOUND", field: "id" }
      ],
      [
        { kind: "change-missing" },
        {
          error: "There is no schedule change to undo.",
          code: "NOT_FOUND",
          field: "scheduleChange"
        }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) => operation({
        task: { findUnique: async () => result.kind === "task-missing" ? null : { id: "task-1" } },
        taskScheduleChange: { findFirst: async () => null }
      });
      const response = await undoTaskSchedule(
        new NextRequest("http://localhost/api/tasks/task-1/schedule/undo", {
          method: "POST"
        }),
        { params: Promise.resolve({ id: "task-1" }) }
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), body);
    }

    for (const code of ["P2003", "P2025"]) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw prismaError(code);
      };
      const response = await undoTaskSchedule(
        new NextRequest("http://localhost/api/tasks/task-1/schedule/undo", {
          method: "POST"
        }),
        { params: Promise.resolve({ id: "task-1" }) }
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "The schedule changed before it could be undone.",
        code: "CONFLICT"
      });
    }

    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const undoFallback = await undoTaskSchedule(
      new NextRequest("http://localhost/api/tasks/task-1/schedule/undo", {
        method: "POST"
      }),
      { params: Promise.resolve({ id: "task-1" }) }
    );
    assert.equal(undoFallback.status, 500);
    assert.deepEqual(await undoFallback.json(), {
      error: "The schedule change could not be undone.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
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
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Planted Prisma error", {
    code,
    clientVersion: "test"
  });
}


test("Focus POST pins invalid mutation identifiers through its handler", async () => {
  const response = await startFocusSession(new NextRequest("http://localhost/api/focus-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dayflow-Mutation-Id": " " },
    body: JSON.stringify({ kind: "FOCUS", plannedMinutes: 25 })
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.", code: "INVALID_MUTATION_ID"
  });
});


test("Focus handlers preserve defensive fieldless validation envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalFindUnique = prisma.focusSession.findUnique;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new FocusSessionError("Timer duration must be between 1 and 240 minutes.");
    };
    const start = await startFocusSession(jsonRequest("http://localhost/api/focus-session", "POST", {
      kind: "FOCUS", plannedMinutes: 25
    }));
    assert.equal(start.status, 400);
    assert.deepEqual(await start.json(), {
      error: "Timer duration must be between 1 and 240 minutes.", code: "VALIDATION_ERROR"
    });
    (prisma.focusSession as unknown as { findUnique: unknown }).findUnique = async () => {
      throw new FocusSessionError("Unknown timer action.");
    };
    const transition = await transitionFocusSession(jsonRequest("http://localhost/api/focus-session/session", "PATCH", {
      action: "pause"
    }), { params: Promise.resolve({ id: "session" }) });
    assert.equal(transition.status, 400);
    assert.deepEqual(await transition.json(), { error: "Unknown timer action.", code: "VALIDATION_ERROR" });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    (prisma.focusSession as unknown as { findUnique: unknown }).findUnique = originalFindUnique;
  }
});

test("Focus queue PATCH and DELETE pin their validation and fallback bodies", async () => {
  const patch = await reorderFocusQueue(jsonRequest("http://localhost/api/focus-queue", "PATCH", { ids: ["task", "task"] }));
  assert.equal(patch.status, 400);
  assert.deepEqual(await patch.json(), {
    error: "Task identifiers must not contain duplicates.", code: "VALIDATION_ERROR", field: "ids"
  });
  const remove = await removeFocusQueueTask(jsonRequest("http://localhost/api/focus-queue", "DELETE", { taskId: "" }));
  assert.equal(remove.status, 400);
  assert.deepEqual(await remove.json(), {
    error: "Task identifier is invalid.", code: "VALIDATION_ERROR", field: "taskId"
  });
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => { throw new Error("unexpected"); };
    for (const [handler, method, payload] of [
      [reorderFocusQueue, "PATCH", { ids: ["task"], expectedIds: ["task"] }],
      [removeFocusQueueTask, "DELETE", { taskId: "task" }]
    ] as const) {
      const response = await handler(jsonRequest("http://localhost/api/focus-queue", method, payload));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Focus queue could not be saved.", code: "INTERNAL_ERROR" });
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});
