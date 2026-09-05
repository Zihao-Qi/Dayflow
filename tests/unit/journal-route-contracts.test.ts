import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  GET as getNotes,
  POST as createNote
} from "../../src/app/api/notes/route";
import {
  GET as getMaterials,
  POST as createMaterial
} from "../../src/app/api/materials/route";
import {
  mutationRequestHash
} from "../../src/lib/idempotent-mutations";
import { prisma } from "../../src/lib/prisma";

test("Journal GET routes keep the code-error shape for validation and internal failures", async () => {
  const noteValidation = await getNotes(
    new NextRequest("http://localhost/api/notes?cursor=not-a-cursor")
  );
  assert.equal(noteValidation.status, 400);
  assert.deepEqual(await noteValidation.json(), {
    code: "INVALID_CURSOR",
    error: "The pagination cursor is invalid."
  });

  const materialValidation = await getMaterials(
    new NextRequest("http://localhost/api/materials?tag=architecture")
  );
  assert.equal(materialValidation.status, 400);
  assert.deepEqual(await materialValidation.json(), {
    code: "VALIDATION_ERROR",
    error: "Tag filtering is available only for Notes."
  });

  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const noteFallback = await getNotes(
      new NextRequest("http://localhost/api/notes")
    );
    assert.equal(noteFallback.status, 500);
    assert.deepEqual(await noteFallback.json(), {
      code: "INTERNAL_ERROR",
      error: "Notes could not be loaded."
    });
    const materialFallback = await getMaterials(
      new NextRequest("http://localhost/api/materials")
    );
    assert.equal(materialFallback.status, 500);
    assert.deepEqual(await materialFallback.json(), {
      code: "INTERNAL_ERROR",
      error: "References could not be loaded."
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction =
      originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Journal POST routes pin relationship, receipt, and fallback envelopes without field", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ task: { findUnique: async () => null } });
    const missingTask = await createNote(
      jsonRequest("http://localhost/api/notes", {
        content: "Linked note",
        taskId: "missing-task"
      })
    );
    assert.equal(missingTask.status, 404);
    assert.deepEqual(await missingTask.json(), {
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked task could not be found."
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ project: { findUnique: async () => null } });
    const missingProject = await createNote(
      jsonRequest("http://localhost/api/notes", {
        content: "Linked note",
        projectId: "missing-project"
      })
    );
    assert.equal(missingProject.status, 404);
    assert.deepEqual(await missingProject.json(), {
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked project could not be found."
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) =>
      operation({
        task: {
          findUnique: async () => ({ id: "task", projectId: "project-a" })
        },
        project: { findUnique: async () => ({ id: "project-b" }) }
      });
    const attributionConflict = await createNote(
      jsonRequest("http://localhost/api/notes", {
        content: "Conflicting note",
        taskId: "task",
        projectId: "project-b"
      })
    );
    assert.equal(attributionConflict.status, 409);
    assert.deepEqual(await attributionConflict.json(), {
      code: "ATTRIBUTION_CONFLICT",
      error: "The selected task belongs to a different project."
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ note: { findUnique: async () => null } });
    const missingNote = await createMaterial(
      jsonRequest("http://localhost/api/materials", {
        url: "https://example.com",
        noteId: "missing-note"
      })
    );
    assert.equal(missingNote.status, 404);
    assert.deepEqual(await missingNote.json(), {
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked note could not be found."
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ task: { findUnique: async () => null } });
    const missingMaterialTask = await createMaterial(
      jsonRequest("http://localhost/api/materials", {
        url: "https://example.com",
        taskId: "missing-task"
      })
    );
    assert.equal(missingMaterialTask.status, 404);
    assert.deepEqual(await missingMaterialTask.json(), {
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked task could not be found."
    });

    (prisma as unknown as { $transaction: unknown }).$transaction = async (
      operation: (transaction: unknown) => unknown
    ) => operation({ project: { findUnique: async () => null } });
    const missingMaterialProject = await createMaterial(
      jsonRequest("http://localhost/api/materials", {
        url: "https://example.com",
        projectId: "missing-project"
      })
    );
    assert.equal(missingMaterialProject.status, 404);
    assert.deepEqual(await missingMaterialProject.json(), {
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked project could not be found."
    });

    const notePayload = { content: "Receipt note" };
    for (const [receipt, status, body] of [
      [
        {
          kind: "material.create",
          requestHash: "different",
          responseJson: "{}"
        },
        409,
        {
          code: "MUTATION_ID_CONFLICT",
          error: "This mutation identifier was already used for a different request."
        }
      ],
      [
        {
          kind: "note.create",
          requestHash: mutationRequestHash("note.create", notePayload),
          responseJson: "{"
        },
        500,
        {
          code: "INVALID_MUTATION_RECEIPT",
          error: "The saved mutation receipt could not be read."
        }
      ]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) =>
        operation({
          mutationReceipt: { findUnique: async () => receipt }
        });
      const response = await createNote(
        jsonRequest("http://localhost/api/notes", notePayload, {
          "X-Dayflow-Mutation-Id": "receipt-note"
        })
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const noteFallback = await createNote(
      jsonRequest("http://localhost/api/notes", { content: "Note" })
    );
    assert.equal(noteFallback.status, 500);
    assert.deepEqual(await noteFallback.json(), {
      code: "INTERNAL_ERROR",
      error: "The note could not be saved."
    });
    const materialFallback = await createMaterial(
      jsonRequest("http://localhost/api/materials", {
        url: "https://example.com"
      })
    );
    assert.equal(materialFallback.status, 500);
    assert.deepEqual(await materialFallback.json(), {
      code: "INTERNAL_ERROR",
      error: "The reference could not be saved."
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction =
      originalTransaction;
    console.error = originalConsoleError;
  }
});

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}


test("Journal GET routes pin Notes validation and Materials cursor errors", async () => {
  const notes = await getNotes(new NextRequest("http://localhost/api/notes?limit=0"));
  assert.equal(notes.status, 400);
  assert.deepEqual(await notes.json(), {
    code: "VALIDATION_ERROR", error: "Page limit must be a positive whole number."
  });
  const materials = await getMaterials(new NextRequest("http://localhost/api/materials?cursor=not-a-cursor"));
  assert.equal(materials.status, 400);
  assert.deepEqual(await materials.json(), {
    code: "INVALID_CURSOR", error: "The pagination cursor is invalid."
  });
});

test("Materials POST pins receipt and attribution bodies through its handler", async () => {
  const originalTransaction = prisma.$transaction;
  const payload = { url: "https://example.com" };
  try {
    for (const [requestHash, responseJson, status, body] of [
      ["different", "{}", 409, {
        code: "MUTATION_ID_CONFLICT", error: "This mutation identifier was already used for a different request."
      }],
      [mutationRequestHash("material.create", payload), "{", 500, {
        code: "INVALID_MUTATION_RECEIPT", error: "The saved mutation receipt could not be read."
      }]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) => operation({ mutationReceipt: { findUnique: async () => ({ kind: "material.create", requestHash, responseJson }) } });
      const response = await createMaterial(jsonRequest("http://localhost/api/materials", payload, {
        "X-Dayflow-Mutation-Id": "material-receipt"
      }));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
    for (const relation of ["task", "note"] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (
        operation: (transaction: unknown) => unknown
      ) => operation({
        task: { findUnique: async () => ({ id: "task", projectId: "other" }) },
        project: { findUnique: async () => ({ id: "project" }) },
        note: { findUnique: async () => ({ id: "note", projectId: "other", task: null }) }
      });
      const response = await createMaterial(jsonRequest("http://localhost/api/materials", {
        ...payload, projectId: "project", [relation === "task" ? "taskId" : "noteId"]: relation
      }));
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        code: "ATTRIBUTION_CONFLICT", error: `The selected ${relation} belongs to a different project.`
      });
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
  }
});
