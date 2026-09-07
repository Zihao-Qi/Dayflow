import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as createTask } from "../../src/app/api/tasks/route";
import {
  DELETE as deleteTask,
  PATCH as updateTask
} from "../../src/app/api/tasks/[id]/route";
import { mutationRequestHash } from "../../src/lib/idempotent-mutations";
import { getPrisma } from "../../src/lib/prisma";
const prisma = getPrisma();

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

test("Task create pins placement, Prisma P2003, and internal envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({});
    const placement = await createTask(
      jsonRequest("http://localhost/api/tasks", "POST", {
        title: "Task",
        phaseId: "phase-without-project"
      })
    );
    assert.equal(placement.status, 400);
    assert.deepEqual(await placement.json(), {
      error: "A task cannot have a phase without a project.",
      code: "VALIDATION_ERROR",
      field: "phaseId"
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ project: { findUnique: async () => null } });
    const missingProject = await createTask(
      jsonRequest("http://localhost/api/tasks", "POST", {
        title: "Task",
        projectId: "missing-project"
      })
    );
    assert.equal(missingProject.status, 404);
    assert.deepEqual(await missingProject.json(), {
      error: "The selected project could not be found.",
      code: "RELATIONSHIP_NOT_FOUND",
      field: "projectId"
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) =>
      operation({
        project: { findUnique: async () => ({ status: "ACTIVE" }) },
        projectPhase: { findUnique: async () => null }
      });
    const missingPhase = await createTask(
      jsonRequest("http://localhost/api/tasks", "POST", {
        title: "Task",
        projectId: "project-id",
        phaseId: "missing-phase"
      })
    );
    assert.equal(missingPhase.status, 404);
    assert.deepEqual(await missingPhase.json(), {
      error: "The selected phase could not be found.",
      code: "RELATIONSHIP_NOT_FOUND",
      field: "phaseId"
    });

    for (const [error, status, body] of [
      [
        prismaError("P2003"),
        409,
        {
          error: "The selected task relationship is no longer available.",
          code: "CONFLICT"
        }
      ],
      [
        new Error("unexpected"),
        500,
        { error: "Task could not be created.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response = await createTask(
        jsonRequest("http://localhost/api/tasks", "POST", { title: "Task" })
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Task item routes pin P2025, P2003, and action-specific fallbacks", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [route, error, status, body] of [
      [
        "patch",
        prismaError("P2025"),
        404,
        { error: "Task not found.", code: "NOT_FOUND" }
      ],
      [
        "delete",
        prismaError("P2025"),
        404,
        { error: "Task not found.", code: "NOT_FOUND" }
      ],
      [
        "patch",
        prismaError("P2003"),
        409,
        {
          error: "A related record changed before the task could be saved.",
          code: "CONFLICT"
        }
      ],
      [
        "delete",
        prismaError("P2003"),
        409,
        {
          error: "A related record changed before the task could be saved.",
          code: "CONFLICT"
        }
      ],
      [
        "delete",
        new Error("unexpected"),
        500,
        { error: "Task could not be deleted.", code: "INTERNAL_ERROR" }
      ],
      [
        "patch",
        new Error("unexpected"),
        500,
        { error: "Task could not be saved.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response =
        route === "patch"
          ? await updateTask(
              jsonRequest("http://localhost/api/tasks/task-id", "PATCH", {
                title: "Task"
              }),
              params("task-id")
            )
          : await deleteTask(
              new NextRequest("http://localhost/api/tasks/task-id", {
                method: "DELETE"
              }),
              params("task-id")
            );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
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

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Planted Prisma error", {
    code,
    clientVersion: "test"
  });
}


test("Task create pins its own mismatch and corrupt receipt bodies", async () => {
  const originalTransaction = prisma.$transaction;
  const payload = { title: "Receipt task" };
  try {
    for (const [requestHash, responseJson, status, body] of [
      ["different", "{}", 409, {
        error: "This mutation identifier was already used for a different request.",
        code: "MUTATION_ID_CONFLICT"
      }],
      [mutationRequestHash("task.create", payload), "{", 500, {
        error: "The saved mutation receipt could not be read.",
        code: "INVALID_MUTATION_RECEIPT"
      }]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) => operation({ mutationReceipt: { findUnique: async () => ({
        kind: "task.create", requestHash, responseJson
      }) } });
      const response = await createTask(jsonRequest("http://localhost/api/tasks", "POST", payload, {
        "X-Dayflow-Mutation-Id": "task-receipt"
      }));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
  }
});

test("Task POST and PATCH pin each placement error independently", async () => {
  const originalTransaction = prisma.$transaction;
  try {
    for (const method of ["POST", "PATCH"] as const) {
      for (const [placement, project, phase, status, body] of [
        [{ phaseId: "phase" }, null, null, 400, {
          error: "A task cannot have a phase without a project.", code: "VALIDATION_ERROR", field: "phaseId"
        }],
        [{ projectId: "project" }, null, null, 404, {
          error: "The selected project could not be found.", code: "RELATIONSHIP_NOT_FOUND", field: "projectId"
        }],
        [{ projectId: "project", phaseId: "phase" }, { status: "ACTIVE" }, null, 404, {
          error: "The selected phase could not be found.", code: "RELATIONSHIP_NOT_FOUND", field: "phaseId"
        }],
        [{ projectId: "project" }, { status: "COMPLETED" }, null, 409, {
          error: "Reopen the completed project before adding unfinished work.", code: "RELATIONSHIP_CONFLICT", field: "projectId"
        }],
        [{ projectId: "project", phaseId: "phase" }, { status: "ACTIVE" }, { projectId: "other" }, 409, {
          error: "The selected phase does not belong to this project.", code: "RELATIONSHIP_CONFLICT", field: "phaseId"
        }]
      ] as const) {
        (prisma as unknown as { $transaction: unknown }).$transaction = async (
          operation: (transaction: unknown) => unknown
        ) => operation({
          task: { findUnique: async () => ({ date: null, projectId: null, phaseId: null, status: "TODO" }) },
          project: { findUnique: async () => project },
          projectPhase: { findUnique: async () => phase }
        });
        const response = method === "POST"
          ? await createTask(jsonRequest("http://localhost/api/tasks", method, { title: "Task", ...placement }))
          : await updateTask(jsonRequest("http://localhost/api/tasks/task", method, placement), params("task"));
        assert.equal(response.status, status, `${method}: ${body.error}`);
        assert.deepEqual(await response.json(), body);
      }
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
  }
});
