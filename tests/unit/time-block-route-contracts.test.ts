import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as createTimeBlock } from "../../src/app/api/time-blocks/route";
import {
  DELETE as deleteTimeBlock,
  PUT as replaceTimeBlock
} from "../../src/app/api/time-blocks/[id]/route";
import {
  TIME_BLOCK_ID_MAX_LENGTH,
  TIME_BLOCK_TITLE_MAX_LENGTH,
  TimeBlockError
} from "../../src/lib/time-blocks";
import { IdempotentMutationError } from "../../src/lib/idempotent-mutations";
import { getPrisma } from "../../src/lib/prisma";
const prisma = getPrisma();
import { timeBlockMutationErrorResponse } from "../../src/server/time-blocks";

const validBody = {
  date: localDateKey(new Date()),
  startTime: "09:00",
  endTime: "10:00",
  title: "Plan the implementation",
  taskId: null
};

test("Time Block create and replace return typed malformed-JSON responses", async () => {
  const createResponse = await createTimeBlock(
    invalidJsonRequest("http://localhost/api/time-blocks", "POST")
  );
  assert.equal(createResponse.status, 400);
  assert.deepEqual(await createResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });

  const replaceResponse = await replaceTimeBlock(
    invalidJsonRequest("http://localhost/api/time-blocks/block-1", "PUT"),
    params("block-1")
  );
  assert.equal(replaceResponse.status, 400);
  assert.deepEqual(await replaceResponse.json(), {
    error: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  });
});

test("Time Block routes reject non-object bodies before persistence", async () => {
  for (const body of [null, [], "text"]) {
    const response = await createTimeBlock(
      rawJsonRequest("http://localhost/api/time-blocks", "POST", body)
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request body must be a JSON object.",
      code: "VALIDATION_ERROR",
      field: "body"
    });
  }
});

test("Time Block create exposes typed field validation", async () => {
  const invalidDate = await createTimeBlock(
    jsonRequest("http://localhost/api/time-blocks", "POST", {
      ...validBody,
      date: "2026-02-30"
    })
  );
  assert.equal(invalidDate.status, 400);
  assert.deepEqual(await invalidDate.json(), {
    error: "Time Block date must be a valid local date in YYYY-MM-DD format.",
    code: "VALIDATION_ERROR",
    field: "date"
  });

  const invalidInterval = await createTimeBlock(
    jsonRequest("http://localhost/api/time-blocks", "POST", {
      ...validBody,
      startTime: "10:00",
      endTime: "09:00"
    })
  );
  assert.equal(invalidInterval.status, 400);
  assert.deepEqual(await invalidInterval.json(), {
    error: "Time Block end time must be later than its start time.",
    code: "VALIDATION_ERROR",
    field: "endTime"
  });

  const invalidTitle = await createTimeBlock(
    jsonRequest("http://localhost/api/time-blocks", "POST", {
      ...validBody,
      title: "x".repeat(TIME_BLOCK_TITLE_MAX_LENGTH + 1)
    })
  );
  assert.equal(invalidTitle.status, 400);
  assert.deepEqual(await invalidTitle.json(), {
    error: `Time Block title must be ${TIME_BLOCK_TITLE_MAX_LENGTH} characters or fewer.`,
    code: "VALIDATION_ERROR",
    field: "title"
  });
});

test("Time Block replace applies the same full-draft validation", async () => {
  const response = await replaceTimeBlock(
    jsonRequest("http://localhost/api/time-blocks/block-1", "PUT", {
      date: validBody.date,
      startTime: validBody.startTime,
      endTime: validBody.endTime,
      taskId: null
    }),
    params("block-1")
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Time Block title is required.",
    code: "VALIDATION_ERROR",
    field: "title"
  });
});

test("Time Block create validates mutation identifiers before writing", async () => {
  const response = await createTimeBlock(
    jsonRequest(
      "http://localhost/api/time-blocks",
      "POST",
      validBody,
      { "X-Dayflow-Mutation-Id": " " }
    )
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
    code: "INVALID_MUTATION_ID"
  });
});

test("Time Block item routes reject invalid path identifiers before querying", async () => {
  for (const id of ["", " ", "block\u0000id", "x".repeat(TIME_BLOCK_ID_MAX_LENGTH + 1)]) {
    const replaceResponse = await replaceTimeBlock(
      jsonRequest("http://localhost/api/time-blocks/invalid", "PUT", validBody),
      params(id)
    );
    assert.equal(replaceResponse.status, 400);
    assert.deepEqual(await replaceResponse.json(), {
      error: "Time Block identifier is invalid.",
      code: "VALIDATION_ERROR",
      field: "id"
    });

    const deleteResponse = await deleteTimeBlock(
      new NextRequest("http://localhost/api/time-blocks/invalid", {
        method: "DELETE"
      }),
      params(id)
    );
    assert.equal(deleteResponse.status, 400);
    assert.deepEqual(await deleteResponse.json(), {
      error: "Time Block identifier is invalid.",
      code: "VALIDATION_ERROR",
      field: "id"
    });
  }
});

test("Time Block error mapping pins idempotency, domain, Prisma, and fallback envelopes", async () => {
  const cases: Array<[unknown, "create" | "save" | "delete", number, Record<string, unknown>]> = [
    [
      new IdempotentMutationError(
        "INVALID_MUTATION_ID",
        "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
        400
      ),
      "create",
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
      "create",
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
      "create",
      500,
      {
        error: "The saved mutation receipt could not be read.",
        code: "INVALID_MUTATION_RECEIPT"
      }
    ],
    [
      new TimeBlockError(
        "This Time Block overlaps \"Planning\" at 09:00–10:00.",
        "TIME_BLOCK_OVERLAP",
        409,
        "startTime"
      ),
      "save",
      409,
      {
        error: "This Time Block overlaps \"Planning\" at 09:00–10:00.",
        code: "TIME_BLOCK_OVERLAP",
        field: "startTime"
      }
    ],
    [
      new TimeBlockError("Time Block not found.", "NOT_FOUND", 404, "id"),
      "save",
      404,
      { error: "Time Block not found.", code: "NOT_FOUND", field: "id" }
    ],
    [
      new TimeBlockError(
        "The selected Task could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        404,
        "taskId"
      ),
      "create",
      404,
      {
        error: "The selected Task could not be found.",
        code: "RELATIONSHIP_NOT_FOUND",
        field: "taskId"
      }
    ],
    [
      new TimeBlockError(
        "Choose an unfinished Task scheduled for the same day as the Time Block.",
        "RELATIONSHIP_CONFLICT",
        409,
        "taskId"
      ),
      "create",
      409,
      {
        error: "Choose an unfinished Task scheduled for the same day as the Time Block.",
        code: "RELATIONSHIP_CONFLICT",
        field: "taskId"
      }
    ],
    [
      prismaError("P2025"),
      "delete",
      404,
      { error: "Time Block not found.", code: "NOT_FOUND", field: "id" }
    ],
    [
      prismaError("P2003"),
      "create",
      404,
      {
        error: "The selected Task could not be found.",
        code: "RELATIONSHIP_NOT_FOUND",
        field: "taskId"
      }
    ],
    [
      new Error("unexpected"),
      "create",
      500,
      { error: "Time Block could not be created.", code: "INTERNAL_ERROR" }
    ],
    [
      new Error("unexpected"),
      "save",
      500,
      { error: "Time Block could not be saved.", code: "INTERNAL_ERROR" }
    ],
    [
      new Error("unexpected"),
      "delete",
      500,
      { error: "Time Block could not be deleted.", code: "INTERNAL_ERROR" }
    ]
  ];

  cases.push([
    new TimeBlockError("Time Block not found.", "NOT_FOUND", 404),
    "save", 404, { error: "Time Block not found.", code: "NOT_FOUND" }
  ]);
  const originalTransaction = prisma.$transaction;
  const originalDelete = prisma.timeBlock.delete;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [error, action, status, body] of cases) {
      const response = timeBlockMutationErrorResponse(error, action);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
      const fail = async () => { throw error; };
      (prisma as unknown as { $transaction: unknown }).$transaction = fail;
      (prisma.timeBlock as unknown as { delete: unknown }).delete = fail;
      const actions = error instanceof IdempotentMutationError ? ["create"]
        : error instanceof TimeBlockError || error instanceof Prisma.PrismaClientKnownRequestError
          ? ["create", "save", "delete"] : [action];
      for (const routeAction of actions) {
        const routeResponse = routeAction === "create"
          ? await createTimeBlock(jsonRequest("http://localhost/api/time-blocks", "POST", validBody))
          : routeAction === "save"
            ? await replaceTimeBlock(jsonRequest("http://localhost/api/time-blocks/block", "PUT", validBody), params("block"))
            : await deleteTimeBlock(new NextRequest("http://localhost/api/time-blocks/block", { method: "DELETE" }), params("block"));
        assert.equal(routeResponse.status, status);
        assert.deepEqual(await routeResponse.json(), body);
      }
    }
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    (prisma.timeBlock as unknown as { delete: unknown }).delete = originalDelete;
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

function rawJsonRequest(
  url: string,
  method: "POST" | "PUT",
  body: unknown
) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Planted Prisma error", {
    code,
    clientVersion: "test"
  });
}

test("Time Block create and replace pin invalid date bodies", async () => {
  const payload = { ...validBody, date: "2026-02-30" };
  for (const response of [
    await createTimeBlock(jsonRequest("http://localhost/api/time-blocks", "POST", payload)),
    await replaceTimeBlock(jsonRequest("http://localhost/api/time-blocks/block", "PUT", payload), params("block"))
  ]) {
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Time Block date must be a valid local date in YYYY-MM-DD format.", code: "VALIDATION_ERROR", field: "date"
    });
  }
});
