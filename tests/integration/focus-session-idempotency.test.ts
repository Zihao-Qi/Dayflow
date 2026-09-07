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

  const [{ POST }, { getPrisma }] = await Promise.all([
    import("../../src/app/api/focus-session/route"),
    import("../../src/lib/prisma")
  ]);
  const prisma = getPrisma();
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
      const persisted = await prisma.focusSession.findFirstOrThrow();
      const expectedSession = {
        id: persisted.id,
        activeKey: 1,
        kind: "FOCUS",
        plannedMinutes: 30,
        actualMinutes: 0,
        label: "One active focus",
        startedAt: persisted.startedAt.toISOString(),
        pausedAt: null,
        accumulatedPauseSeconds: 0,
        status: "RUNNING",
        completedAt: null,
        needsEnrichment: false,
        enrichedAt: null,
        completionNote: null,
        completionCategory: null,
        taskId: null,
        projectId: null,
        createdAt: persisted.createdAt.toISOString(),
        updatedAt: persisted.updatedAt.toISOString(),
        task: null,
        project: null,
        activity: null
      };
      assert.deepEqual(bodies[statuses.indexOf(201)], {
        session: expectedSession,
        snapshot: {
          active: expectedSession,
          pendingCompletion: null,
          today: { completedSessions: 0, focusedMinutes: 0 }
        }
      });
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

  await context.test(
    "a delayed Focus start excludes body waiting from persisted timer time",
    async regression => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.focusSession.deleteMany();
      const [{ clock }, { PATCH }] = await Promise.all([
        import("../../src/lib/time"),
        import("../../src/app/api/focus-session/[id]/route")
      ]);
      const requestTime = new Date("2026-09-04T23:59:00-05:00");
      const insertionTime = new Date("2026-09-05T00:02:00-05:00");
      let currentTime = requestTime;
      regression.mock.method(clock, "now", () => currentTime);
      // Distinguish the original snapshot day from the later insertion day.
      await prisma.focusSession.create({ data: {
        kind: "FOCUS", plannedMinutes: 25, status: "COMPLETED",
        startedAt: new Date("2026-09-04T22:00:00-05:00"),
        completedAt: new Date("2026-09-04T22:00:30-05:00")
      } });
      const payload = { kind: "FOCUS", plannedMinutes: 25 };
      const request = focusStartRequest("delayed-focus-body", payload);
      let releaseBody!: () => void;
      let bodyEntered!: () => void;
      const bodyReady = new Promise<void>(resolve => { releaseBody = resolve; });
      const bodyStarted = new Promise<void>(resolve => { bodyEntered = resolve; });
      regression.mock.method(request, "json", async () => {
        bodyEntered();
        await bodyReady;
        return payload;
      });
      const pending = POST(request);
      try {
        await bodyStarted;
        currentTime = insertionTime;
        releaseBody();
        const response = await pending;
        assert.equal(response.status, 201);
        const body = await response.json();
        const persisted = await prisma.focusSession.findUniqueOrThrow({ where: { id: body.session.id } });
        assert.deepEqual(persisted.startedAt, insertionTime);
        assert.equal(body.session.startedAt, insertionTime.toISOString());
        assert.equal(body.snapshot.today.completedSessions, 1);
        const completion = await PATCH(new NextRequest(`http://localhost/api/focus-session/${persisted.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete" })
        }), { params: Promise.resolve({ id: persisted.id }) });
        assert.equal(completion.status, 200);
        assert.equal((await completion.json()).completedSession.actualMinutes, 0);
        assert.equal(await prisma.activityEntry.count(), 0);
      } finally {
        releaseBody();
        await pending;
      }
    }
  );

  await context.test(
    "a queued Focus start excludes serializer waiting from persisted timer time",
    async regression => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.focusSession.deleteMany();
      const { clock } = await import("../../src/lib/time");
      const requestTime = new Date("2026-09-04T23:59:00-05:00");
      const insertionTime = new Date("2026-09-05T00:04:00-05:00");
      let currentTime = requestTime;
      regression.mock.method(clock, "now", () => currentTime);
      const queueState = globalThis as typeof globalThis & {
        dayflowFocusSessionStartQueue?: Promise<void>;
      };
      await queueState.dayflowFocusSessionStartQueue;
      const previousQueue = Object.getOwnPropertyDescriptor(queueState, "dayflowFocusSessionStartQueue");
      let releaseQueue!: () => void;
      let observeSerializerEntry!: () => void;
      const heldQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
      const serializerEntered = new Promise<void>(resolve => { observeSerializerEntry = resolve; });
      let queuedTail = heldQueue;
      // The serializer publishes its new tail only after attaching work to the held queue.
      Object.defineProperty(queueState, "dayflowFocusSessionStartQueue", {
        configurable: true,
        get: () => queuedTail,
        set: (tail: Promise<void>) => {
          queuedTail = tail;
          observeSerializerEntry();
        }
      });
      let pending: ReturnType<typeof POST> | undefined;
      try {
        pending = POST(focusStartRequest("queued-focus-start", { kind: "FOCUS", plannedMinutes: 25 }));
        await Promise.race([
          serializerEntered,
          pending.then(() => assert.fail("POST finished before entering the held serializer"))
        ]);
        assert.notEqual(queuedTail, heldQueue);
        assert.equal(await prisma.focusSession.count(), 0);
        currentTime = insertionTime;
        releaseQueue();
        const response = await pending;
        assert.equal(response.status, 201);
        const body = await response.json();
        const persisted = await prisma.focusSession.findUniqueOrThrow({ where: { id: body.session.id } });
        assert.deepEqual(persisted.startedAt, insertionTime);
        assert.equal(body.session.startedAt, insertionTime.toISOString());
      } finally {
        releaseQueue();
        try {
          await pending;
          await queuedTail;
        } finally {
          if (previousQueue) Object.defineProperty(queueState, "dayflowFocusSessionStartQueue", previousQueue);
          else delete queueState.dayflowFocusSessionStartQueue;
        }
      }
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
