import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as createActivity } from "../../src/app/api/activities/route";
import {
  DELETE as deleteActivity,
  PUT as updateActivity
} from "../../src/app/api/activities/[id]/route";
import { PUT as saveDiary } from "../../src/app/api/diary/route";
import { POST as createMaterial } from "../../src/app/api/materials/route";
import { POST as createNote } from "../../src/app/api/notes/route";
import { activityMutationErrorResponse } from "../../src/server/evidence";
import { ActivityPersistenceError } from "../../src/server/evidence";
import { addDays, localDateKey } from "../../src/lib/dates";
import { EvidenceAttributionError } from "../../src/lib/evidence-attribution";
import { EvidenceMutationRequestError } from "../../src/lib/evidence-mutations";
import { IdempotentMutationError } from "../../src/lib/idempotent-mutations";
import { prisma } from "../../src/lib/prisma";

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

  const futureActivityResponse = await createActivity(
    jsonRequest("http://localhost/api/activities", "POST", {
      date: localDateKey(addDays(new Date(), 1)),
      durationMinutes: 25,
      note: "Future evidence"
    })
  );
  assert.equal(futureActivityResponse.status, 400);
  assert.deepEqual(await futureActivityResponse.json(), {
    error: "Activity date cannot be in the future.",
    code: "VALIDATION_ERROR",
    field: "date"
  });

  const blankDateResponse = await createActivity(
    jsonRequest("http://localhost/api/activities", "POST", {
      date: "",
      durationMinutes: 25,
      note: "Blank Activity date"
    })
  );
  assert.equal(blankDateResponse.status, 400);
  assert.deepEqual(await blankDateResponse.json(), {
    error: "Activity date is invalid.",
    code: "VALIDATION_ERROR",
    field: "date"
  });

  const blankCategoryResponse = await createActivity(
    jsonRequest("http://localhost/api/activities", "POST", {
      durationMinutes: 25,
      category: " ",
      note: "Blank Activity category"
    })
  );
  assert.equal(blankCategoryResponse.status, 400);
  assert.deepEqual(await blankCategoryResponse.json(), {
    error: "Choose an Activity category.",
    code: "VALIDATION_ERROR",
    field: "category"
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

test("Activity error mapping pins every typed and Prisma branch", async () => {
  const cases: Array<[unknown, number, Record<string, unknown>]> = [
    [
      new IdempotentMutationError(
        "INVALID_MUTATION_ID",
        "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
        400
      ),
      400,
      {
        error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
        code: "INVALID_MUTATION_ID"
      }
    ],
    [
      new IdempotentMutationError(
        "MUTATION_ID_CONFLICT",
        "This mutation identifier was already used for a different request.",
        409
      ),
      409,
      {
        error: "This mutation identifier was already used for a different request.",
        code: "MUTATION_ID_CONFLICT"
      }
    ],
    [
      new IdempotentMutationError(
        "INVALID_MUTATION_RECEIPT",
        "The saved mutation receipt could not be read.",
        500
      ),
      500,
      {
        error: "The saved mutation receipt could not be read.",
        code: "INVALID_MUTATION_RECEIPT"
      }
    ],
    [
      new EvidenceMutationRequestError(
        "Duration must be between 1 and 1440 minutes.",
        "durationMinutes"
      ),
      400,
      {
        error: "Duration must be between 1 and 1440 minutes.",
        code: "VALIDATION_ERROR",
        field: "durationMinutes"
      }
    ],
    [
      new EvidenceAttributionError(
        "The linked task could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        "taskId",
        404
      ),
      404,
      {
        error: "The linked task could not be found.",
        code: "RELATIONSHIP_NOT_FOUND",
        field: "taskId"
      }
    ],
    [
      new EvidenceAttributionError(
        "The linked project could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        "projectId",
        404
      ),
      404,
      {
        error: "The linked project could not be found.",
        code: "RELATIONSHIP_NOT_FOUND",
        field: "projectId"
      }
    ],
    [
      new EvidenceAttributionError(
        "The selected task belongs to a different project.",
        "ATTRIBUTION_CONFLICT",
        "projectId",
        409
      ),
      409,
      {
        error: "The selected task belongs to a different project.",
        code: "ATTRIBUTION_CONFLICT",
        field: "projectId"
      }
    ],
    [
      new ActivityPersistenceError(
        "Activity not found.",
        "ACTIVITY_NOT_FOUND",
        404
      ),
      404,
      { error: "Activity not found.", code: "ACTIVITY_NOT_FOUND" }
    ],
    [
      new ActivityPersistenceError(
        "Focus evidence cannot be edited here.",
        "FOCUS_ACTIVITY_PROTECTED",
        409
      ),
      409,
      {
        error: "Focus evidence cannot be edited here.",
        code: "FOCUS_ACTIVITY_PROTECTED"
      }
    ],
    [
      new ActivityPersistenceError(
        "The Activity changed before it could be updated.",
        "CONFLICT",
        409
      ),
      409,
      {
        error: "The Activity changed before it could be updated.",
        code: "CONFLICT"
      }
    ]
  ];

  for (const code of ["P2003", "P2025"]) {
    cases.push([
      prismaError(code),
      409,
      {
        error: "The linked Activity relationship is no longer available.",
        code: "RELATIONSHIP_CONFLICT"
      }
    ]);
  }
  cases.push([
    new Error("unexpected"),
    500,
    { error: "Activity could not be updated.", code: "INTERNAL_ERROR" }
  ]);

  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [error, status, body] of cases) {
      const response = activityMutationErrorResponse(
        error,
        "Activity update failed.",
        "Activity could not be updated."
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => { throw error; };
      const methods = error instanceof IdempotentMutationError ? ["POST"] as const
        : error instanceof ActivityPersistenceError || status === 500 ? ["PUT"] as const
          : ["POST", "PUT"] as const;
      for (const method of methods) {
        const request = jsonRequest(`http://localhost/api/activities${method === "PUT" ? "/activity" : ""}`, method, {
          startTime: "09:30", durationMinutes: 30, category: "Deep Work", note: "Contract", taskId: null, projectId: null
        });
        const routed = method === "POST" ? await createActivity(request)
          : await updateActivity(request, { params: Promise.resolve({ id: "activity" }) });
        assert.equal(routed.status, status);
        assert.deepEqual(await routed.json(), body);
      }
    }
    const createFallback = activityMutationErrorResponse(
      new Error("unexpected"),
      "Activity creation failed."
    );
    assert.equal(createFallback.status, 500);
    assert.deepEqual(await createFallback.json(), {
      error: "Activity could not be saved.",
      code: "INTERNAL_ERROR"
    });
    const routedFallback = await createActivity(jsonRequest("http://localhost/api/activities", "POST", {
      durationMinutes: 30, category: "Deep Work", note: "Contract"
    }));
    assert.equal(routedFallback.status, 500);
    assert.deepEqual(await routedFallback.json(), { error: "Activity could not be saved.", code: "INTERNAL_ERROR" });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    console.error = originalConsoleError;
  }
});

test("Activity delete pins its code-less and conflict envelopes", async () => {
  const transaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [result, status, body] of [
      ["missing", 404, { error: "Activity not found." }],
      ["protected", 409, { error: "Focus evidence cannot be deleted." }]
    ] as const) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async (run: (tx: unknown) => Promise<unknown>) =>
        run({ activityEntry: { findUnique: async () => result === "missing" ? null : { origin: "FOCUS", focusSessionId: null } } });
      const response = await deleteActivity(
        new NextRequest("http://localhost/api/activities/activity-1", {
          method: "DELETE"
        }),
        { params: Promise.resolve({ id: "activity-1" }) }
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }

    for (const code of ["P2003", "P2025"]) {
      (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
        throw prismaError(code);
      };
      const response = await deleteActivity(
        new NextRequest("http://localhost/api/activities/activity-1", {
          method: "DELETE"
        }),
        { params: Promise.resolve({ id: "activity-1" }) }
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "The Activity changed before it could be deleted.",
        code: "CONFLICT"
      });
    }

    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const response = await deleteActivity(
      new NextRequest("http://localhost/api/activities/activity-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ id: "activity-1" }) }
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Activity could not be deleted.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = transaction;
    console.error = originalConsoleError;
  }
});

test("Diary route pins its internal envelope", async () => {
  const originalTransaction = prisma.$transaction;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async () => {
      throw new Error("unexpected");
    };
    const response = await saveDiary(
      jsonRequest("http://localhost/api/diary", "PUT", {
        date: localDateKey(new Date()),
        content: "Diary"
      })
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Diary could not be saved.",
      code: "INTERNAL_ERROR"
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction =
      originalTransaction;
    console.error = originalConsoleError;
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

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Planted Prisma error", {
    code,
    clientVersion: "test"
  });
}
