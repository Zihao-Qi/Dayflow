import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as createProject } from "../../src/app/api/projects/route";
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as updateProject
} from "../../src/app/api/projects/[id]/route";
import { POST as createPhase } from "../../src/app/api/projects/[id]/phases/route";
import {
  DELETE as deletePhase,
  PATCH as updatePhase
} from "../../src/app/api/phases/[id]/route";
import { mutationRequestHash } from "../../src/lib/idempotent-mutations";
import { prisma } from "../../src/lib/prisma";

// Route reads and phase updates now enter a transaction before calling these delegates.
const originalTransactionRoot = prisma.$transaction;
beforeEach(() => {
  (prisma as unknown as { $transaction: unknown }).$transaction = async (
    operation: (tx: typeof prisma) => unknown
  ) => operation(prisma);
});
afterEach(() => { prisma.$transaction = originalTransactionRoot; });

test("Project and Phase routes return typed malformed-JSON responses", async () => {
  const projectCreateResponse = await createProject(
    invalidJsonRequest("http://localhost/api/projects", "POST")
  );
  assert.equal(projectCreateResponse.status, 400);
  assert.deepEqual(await projectCreateResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const projectPatchResponse = await updateProject(
    invalidJsonRequest("http://localhost/api/projects/project-id", "PATCH"),
    params("project-id")
  );
  assert.equal(projectPatchResponse.status, 400);
  assert.deepEqual(await projectPatchResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const phaseCreateResponse = await createPhase(
    invalidJsonRequest(
      "http://localhost/api/projects/project-id/phases",
      "POST"
    ),
    params("project-id")
  );
  assert.equal(phaseCreateResponse.status, 400);
  assert.deepEqual(await phaseCreateResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const phasePatchResponse = await updatePhase(
    invalidJsonRequest("http://localhost/api/phases/phase-id", "PATCH"),
    params("phase-id")
  );
  assert.equal(phasePatchResponse.status, 400);
  assert.deepEqual(await phasePatchResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });
});

test("Project and Phase routes expose typed validation fields", async () => {
  const projectResponse = await createProject(
    jsonRequest("http://localhost/api/projects", "POST", {
      name: "Project",
      weeklyMinutesBudget: -1
    })
  );
  assert.equal(projectResponse.status, 400);
  assert.deepEqual(await projectResponse.json(), {
    error: "Weekly effort budget must be a whole number from 1 to 10080 minutes.",
    code: "VALIDATION_ERROR",
    field: "weeklyMinutesBudget"
  });

  const phaseResponse = await updatePhase(
    jsonRequest("http://localhost/api/phases/phase-id", "PATCH", {
      sortOrder: -1
    }),
    params("phase-id")
  );
  assert.equal(phaseResponse.status, 400);
  assert.deepEqual(await phaseResponse.json(), {
    error: "Phase order must be a whole number from 0 to 2147483647.",
    code: "VALIDATION_ERROR",
    field: "sortOrder"
  });
});

test("Project and Phase creates validate mutation identifiers before writing", async () => {
  const projectResponse = await createProject(
    jsonRequest(
      "http://localhost/api/projects",
      "POST",
      { name: "Project" },
      { "X-Dayflow-Mutation-Id": " " }
    )
  );
  assert.equal(projectResponse.status, 400);
  assert.deepEqual(await projectResponse.json(), {
    error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
    code: "INVALID_MUTATION_ID"
  });

  const phaseResponse = await createPhase(
    jsonRequest(
      "http://localhost/api/projects/project-id/phases",
      "POST",
      { name: "Phase" },
      { "X-Dayflow-Mutation-Id": "\u0007" }
    ),
    params("project-id")
  );
  assert.equal(phaseResponse.status, 400);
  assert.deepEqual(await phaseResponse.json(), {
    error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
    code: "INVALID_MUTATION_ID"
  });
});

test("Project and Phase path identifiers are validated before querying", async () => {
  const projectPatch = await updateProject(
    jsonRequest("http://localhost/api/projects/invalid", "PATCH", {
      name: "Project"
    }),
    params("")
  );
  assert.equal(projectPatch.status, 400);
  assert.deepEqual(await projectPatch.json(), {
    error: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const phaseCreate = await createPhase(
    jsonRequest("http://localhost/api/projects/invalid/phases", "POST", {
      name: "Phase"
    }),
    params("")
  );
  assert.equal(phaseCreate.status, 400);
  assert.deepEqual(await phaseCreate.json(), {
    error: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "projectId"
  });

  const phasePatch = await updatePhase(
    jsonRequest("http://localhost/api/phases/invalid", "PATCH", {
      name: "Phase"
    }),
    params("")
  );
  assert.equal(phasePatch.status, 400);
  assert.deepEqual(await phasePatch.json(), {
    error: "Phase identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const projectDelete = await deleteProject(
    new NextRequest("http://localhost/api/projects/invalid?confirm=true", {
      method: "DELETE"
    }),
    params("")
  );
  assert.equal(projectDelete.status, 400);
  assert.deepEqual(await projectDelete.json(), {
    error: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });

  const phaseDelete = await deletePhase(
    new NextRequest("http://localhost/api/phases/invalid", {
      method: "DELETE"
    }),
    params("")
  );
  assert.equal(phaseDelete.status, 400);
  assert.deepEqual(await phaseDelete.json(), {
    error: "Phase identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  });
});

test("Project deletion requires a typed confirmation response", async () => {
  const response = await deleteProject(
    new NextRequest("http://localhost/api/projects/project-id", {
      method: "DELETE"
    }),
    params("project-id")
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Project deletion requires confirmation.",
    code: "VALIDATION_ERROR",
    field: "confirm"
  });
});

test("Project detail keeps its legacy code-less not-found envelope", async () => {
  const originalFindUnique = prisma.project.findUnique;
  try {
    (prisma.project as unknown as { findUnique: unknown }).findUnique = async () =>
      null;
    const response = await getProject(
      new NextRequest("http://localhost/api/projects/missing"),
      params("missing")
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Project not found." });
  } finally {
    (prisma.project as unknown as { findUnique: unknown }).findUnique =
      originalFindUnique;
  }
});

test("Project and Phase create pin Prisma and internal envelopes", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [project, status, body] of [
      [
        null,
        404,
        {
          error: "The selected project could not be found.",
          code: "NOT_FOUND",
          field: "projectId"
        }
      ],
      [
        { status: "COMPLETED" },
        409,
        {
          error: "Reopen the completed project before adding unfinished work.",
          code: "RELATIONSHIP_CONFLICT",
          field: "projectId"
        }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) => operation({ project: { findUnique: async () => project } });
      const response = await createPhase(
        jsonRequest("http://localhost/api/projects/project-id/phases", "POST", {
          name: "Phase"
        }),
        params("project-id")
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    for (const [route, error, status, body] of [
      [
        "project",
        prismaError("P2003"),
        409,
        {
          error: "A related record changed before the Project could be created.",
          code: "CONFLICT"
        }
      ],
      [
        "project",
        new Error("unexpected"),
        500,
        { error: "Project could not be created.", code: "INTERNAL_ERROR" }
      ],
      [
        "phase",
        prismaError("P2003"),
        409,
        {
          error: "The selected Project is no longer available.",
          code: "CONFLICT",
          field: "projectId"
        }
      ],
      [
        "phase",
        new Error("unexpected"),
        500,
        { error: "Phase could not be created.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response =
        route === "project"
          ? await createProject(
              jsonRequest("http://localhost/api/projects", "POST", {
                name: "Project"
              })
            )
          : await createPhase(
              jsonRequest("http://localhost/api/projects/project-id/phases", "POST", {
                name: "Phase"
              }),
              params("project-id")
            );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Project and Phase item routes pin P2025, P2003, confirmation, and fallbacks", async () => {
  const originalTransaction = prisma.$transaction;
  const originalFindUnique = prisma.project.findUnique;
  const originalProjectPhaseUpdate = prisma.projectPhase.update;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => ({
      kind: "confirmation-required"
    });
    const confirmation = await updateProject(
      jsonRequest("http://localhost/api/projects/project-id", "PATCH", {
        status: "COMPLETED"
      }),
      params("project-id")
    );
    assert.equal(confirmation.status, 409);
    assert.deepEqual(await confirmation.json(), {
      error: "Confirm completion while unfinished tasks remain.",
      code: "CONFLICT",
      field: "status",
      requiresConfirmation: true
    });

    for (const [error, status, body] of [
      [
        prismaError("P2025"),
        404,
        { error: "Project not found.", code: "NOT_FOUND" }
      ],
      [
        prismaError("P2003"),
        409,
        {
          error: "A related record changed before the Project could be saved.",
          code: "CONFLICT"
        }
      ],
      [
        new Error("unexpected"),
        500,
        { error: "Project could not be saved.", code: "INTERNAL_ERROR" }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response = await updateProject(
        jsonRequest("http://localhost/api/projects/project-id", "PATCH", {
          name: "Project"
        }),
        params("project-id")
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    (prisma.project as unknown as { findUnique: unknown }).findUnique = async () => ({
      id: "project-id"
    });
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const deleteFallback = await deleteProject(
      new NextRequest("http://localhost/api/projects/project-id?confirm=true", {
        method: "DELETE"
      }),
      params("project-id")
    );
    assert.equal(deleteFallback.status, 500);
    assert.deepEqual(await deleteFallback.json(), {
      error: "Project could not be deleted.",
      code: "INTERNAL_ERROR"
    });

    for (const [error, status, body] of [
      [
        prismaError("P2025"),
        404,
        { error: "Project not found.", code: "NOT_FOUND" }
      ],
      [
        prismaError("P2003"),
        409,
        {
          error: "A related record changed before the Project could be saved.",
          code: "CONFLICT"
        }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw error;
      };
      const response = await deleteProject(
        new NextRequest("http://localhost/api/projects/project-id?confirm=true", {
          method: "DELETE"
        }),
        params("project-id")
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    for (const [error, action, expected] of [
      [
        prismaError("P2025"),
        "patch",
        { status: 404, body: { error: "Phase not found.", code: "NOT_FOUND" } }
      ],
      [
        new Error("unexpected"),
        "patch",
        {
          status: 500,
          body: { error: "Phase could not be saved.", code: "INTERNAL_ERROR" }
        }
      ],
      [
        new Error("unexpected"),
        "delete",
        {
          status: 500,
          body: { error: "Phase could not be deleted.", code: "INTERNAL_ERROR" }
        }
      ],
      [
        prismaError("P2025"),
        "delete",
        { status: 404, body: { error: "Phase not found.", code: "NOT_FOUND" } }
      ]
    ] as const) {
      if (action === "patch") {
        (prisma as unknown as { $transaction: unknown }).$transaction = async (
          operation: (tx: typeof prisma) => unknown
        ) => operation(prisma);
        (prisma.projectPhase as unknown as { update: unknown }).update = async () => {
          throw error;
        };
      } else {
        (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
          throw error;
        };
      }
      const response =
        action === "patch"
          ? await updatePhase(
              jsonRequest("http://localhost/api/phases/phase-id", "PATCH", {
                name: "Phase"
              }),
              params("phase-id")
            )
          : await deletePhase(
              new NextRequest("http://localhost/api/phases/phase-id", {
                method: "DELETE"
              }),
              params("phase-id")
            );
      assert.equal(response.status, expected.status);
      assert.deepEqual(await response.json(), expected.body);
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    (prisma.project as unknown as { findUnique: unknown }).findUnique =
      originalFindUnique;
    (prisma.projectPhase as unknown as { update: unknown }).update =
      originalProjectPhaseUpdate;
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


test("Project and Phase create pin their own mismatch and corrupt receipt bodies", async () => {
  const originalTransaction = prisma.$transaction;
  try {
    for (const kind of ["project.create", "phase.create"] as const) {
      const payload = { name: "Receipt record" };
      const receiptPayload = kind === "phase.create" ? { projectId: "project", ...payload } : payload;
      for (const [requestHash, responseJson, status, body] of [
        ["different", "{}", 409, {
          error: "This mutation identifier was already used for a different request.", code: "MUTATION_ID_CONFLICT"
        }],
        [mutationRequestHash(kind, receiptPayload), "{", 500, {
          error: "The saved mutation receipt could not be read.", code: "INVALID_MUTATION_RECEIPT"
        }]
      ] as const) {
        (prisma as unknown as { $transaction: unknown }).$transaction = async (
          operation: (transaction: unknown) => unknown
        ) => operation({ mutationReceipt: { findUnique: async () => ({ kind, requestHash, responseJson }) } });
        const headers = { "X-Dayflow-Mutation-Id": "project-receipt" };
        const response = kind === "project.create"
          ? await createProject(jsonRequest("http://localhost/api/projects", "POST", payload, headers))
          : await createPhase(jsonRequest("http://localhost/api/projects/project/phases", "POST", payload, headers), params("project"));
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), body);
      }
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
  }
});

test("Phase create pins invalid input before persistence", async () => {
  const response = await createPhase(
    jsonRequest("http://localhost/api/projects/project/phases", "POST", { name: "" }), params("project")
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Phase name is required.", code: "VALIDATION_ERROR", field: "name"
  });
});
