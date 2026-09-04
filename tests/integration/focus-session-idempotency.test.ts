import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

test("Focus Session start idempotency", async (context) => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-focus-idempotency-test-")
  );
  const databasePath = join(temporaryDirectory, "dayflow.db");
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnectPrisma: (() => Promise<void>) | null = null;
  process.env.DATABASE_URL = `file:${databasePath.split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnectPrisma?.();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  execFileSync(
    process.execPath,
    [
      prismaCliPath,
      "db",
      "execute",
      "--file",
      "prisma/init.sql",
      "--url",
      process.env.DATABASE_URL
    ],
    { cwd: repositoryRoot, stdio: "pipe" }
  );

  const [{ POST }, { prisma }] = await Promise.all([
    import("../../src/app/api/focus-session/route"),
    import("../../src/lib/prisma")
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  await context.test(
    "a lost-success retry replays the original response without a duplicate",
    async () => {
      const payload = {
        kind: "FOCUS",
        plannedMinutes: 25,
        label: "Idempotent focus"
      };

      const first = await POST(focusStartRequest("focus-start-retry", payload));
      assert.equal(first.status, 201);
      const firstResult: unknown = await first.json();

      const replay = await POST(focusStartRequest("focus-start-retry", payload));
      assert.equal(replay.status, 201);
      assert.deepEqual(await replay.json(), firstResult);
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
    }
  );

  await context.test(
    "reusing an identifier for a different Focus start payload is rejected",
    async () => {
      const mismatch = await POST(
        focusStartRequest("focus-start-retry", {
          kind: "FOCUS",
          plannedMinutes: 50,
          label: "Idempotent focus"
        })
      );

      assert.equal(mismatch.status, 409);
      assert.deepEqual(await mismatch.json(), {
        error:
          "This mutation identifier was already used for a different request.",
        code: "MUTATION_ID_CONFLICT"
      });
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
    }
  );

  await context.test(
    "omitted and blank labels replay as the same canonical Focus start",
    async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.focusSession.deleteMany();
      const mutationId = "focus-start-equivalent-label";
      const payload = {
        kind: "FOCUS",
        plannedMinutes: 25
      };

      const first = await POST(focusStartRequest(mutationId, payload));
      const replay = await POST(
        focusStartRequest(mutationId, { ...payload, label: "   " })
      );

      assert.equal(first.status, 201);
      assert.equal(replay.status, 201);
      assert.deepEqual(await replay.json(), await first.json());
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
    }
  );

  await context.test(
    "simultaneous retries commit one Focus Session and replay one response",
    async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.focusSession.deleteMany();
      const payload = {
        kind: "FOCUS",
        plannedMinutes: 30,
        label: "Concurrent focus"
      };

      const [left, right] = await Promise.all([
        POST(focusStartRequest("focus-start-concurrent", payload)),
        POST(focusStartRequest("focus-start-concurrent", payload))
      ]);
      assert.deepEqual(
        [left.status, right.status].sort((a, b) => a - b),
        [201, 201]
      );
      assert.deepEqual(await left.json(), await right.json());
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(await prisma.mutationReceipt.count(), 1);
    }
  );

  await context.test(
    "different simultaneous starts resolve as one created session and conflicts for every other request",
    async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.focusSession.deleteMany();
      const payload = {
        kind: "FOCUS",
        plannedMinutes: 30,
        label: "One active focus"
      };

      const responseCount = 9;
      const responses = await Promise.all(
        Array.from({ length: responseCount }, (_, index) =>
          POST(focusStartRequest(`focus-start-${index}`, payload))
        )
      );
      const statuses = responses.map((response) => response.status);
      assert.equal(statuses.filter((status) => status === 201).length, 1);
      assert.equal(
        statuses.filter((status) => status === 409).length,
        responseCount - 1
      );
      const bodies = await Promise.all(
        responses.map((response) => response.json())
      );
      for (const [index, status] of statuses.entries()) {
        if (status !== 409) continue;
        assert.deepEqual(bodies[index], {
          error: "Finish or cancel the active timer first.",
          code: "CONFLICT"
        });
      }
      assert.equal(await prisma.focusSession.count(), 1);
      assert.equal(
        await prisma.focusSession.count({
          where: { status: { in: ["RUNNING", "PAUSED"] } }
        }),
        1
      );
      assert.equal(await prisma.mutationReceipt.count(), 1);
    }
  );
});

function focusStartRequest(
  mutationId: string,
  payload: Record<string, unknown>
) {
  return new NextRequest("http://localhost/api/focus-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dayflow-Mutation-Id": mutationId
    },
    body: JSON.stringify(payload)
  });
}
