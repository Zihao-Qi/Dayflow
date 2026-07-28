import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as createProject } from "../../src/app/api/projects/route";
import {
  DELETE as deleteProject,
  PATCH as updateProject
} from "../../src/app/api/projects/[id]/route";
import { POST as createPhase } from "../../src/app/api/projects/[id]/phases/route";
import {
  DELETE as deletePhase,
  PATCH as updatePhase
} from "../../src/app/api/phases/[id]/route";

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
