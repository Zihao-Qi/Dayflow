import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    patchTask: typeof import("../../src/app/api/tasks/[id]/route").PATCH;
    patchProject: typeof import("../../src/app/api/projects/[id]/route").PATCH;
    deleteProject: typeof import("../../src/app/api/projects/[id]/route").DELETE;
    patchFocus: typeof import("../../src/app/api/focus-session/[id]/route").PATCH;
    putActivity: typeof import("../../src/app/api/activities/[id]/route").PUT;
    deleteActivity: typeof import("../../src/app/api/activities/[id]/route").DELETE;
    replaceManualActivityInTransaction: typeof import("../../src/lib/activity-persistence").replaceManualActivityInTransaction;
    ActivityPersistenceError: typeof import("../../src/lib/activity-persistence").ActivityPersistenceError;
  }) => Promise<void>
) {
  const directory = mkdtempSync(
    join(tmpdir(), "dayflow-transactional-workflows-test-")
  );
  const databasePath = join(directory, "dayflow.db");
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnectPrisma: (() => Promise<void>) | null = null;
  process.env.DATABASE_URL = `file:${databasePath.split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnectPrisma?.();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      rmSync(directory, { recursive: true, force: true });
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

  const [taskRoute, projectRoute, focusRoute, activityRoute, persistence, { prisma }] =
    await Promise.all([
      import("../../src/app/api/tasks/[id]/route"),
      import("../../src/app/api/projects/[id]/route"),
      import("../../src/app/api/focus-session/[id]/route"),
      import("../../src/app/api/activities/[id]/route"),
      import("../../src/lib/activity-persistence"),
      import("../../src/lib/prisma")
    ]);
  disconnectPrisma = () => prisma.$disconnect();

  await run({
    prisma,
    patchTask: taskRoute.PATCH,
    patchProject: projectRoute.PATCH,
    deleteProject: projectRoute.DELETE,
    patchFocus: focusRoute.PATCH,
    putActivity: activityRoute.PUT,
    deleteActivity: activityRoute.DELETE,
    replaceManualActivityInTransaction:
      persistence.replaceManualActivityInTransaction,
    ActivityPersistenceError: persistence.ActivityPersistenceError
  });
}

test("seeded transactional workflow conflicts preserve their invariants", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T12:00:00-05:00") });
  await withDatabase(context, async (deps) => {
    const {
      prisma,
      patchTask,
      patchProject,
      deleteProject,
      patchFocus,
      putActivity,
      deleteActivity,
      replaceManualActivityInTransaction,
      ActivityPersistenceError
    } = deps;

    await context.test(
      "task update rejects an incompatible placement and rolls back",
      async () => {
        const [left, right] = await Promise.all([
          prisma.project.create({ data: { name: "Left" } }),
          prisma.project.create({ data: { name: "Right" } })
        ]);
        const phase = await prisma.projectPhase.create({
          data: { projectId: left.id, name: "Left phase" }
        });
        const task = await prisma.task.create({
          data: { title: "Keep placement", projectId: left.id, phaseId: phase.id }
        });

        const response = await patchTask(
          jsonRequest(`/api/tasks/${task.id}`, "PATCH", {
            projectId: right.id,
            phaseId: phase.id
          }),
          params(task.id)
        );
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
          error: "The selected phase does not belong to this project.",
          code: "RELATIONSHIP_CONFLICT",
          field: "phaseId"
        });
        assert.deepEqual(
          await prisma.task.findUniqueOrThrow({
            where: { id: task.id },
            select: { projectId: true, phaseId: true }
          }),
          { projectId: left.id, phaseId: phase.id }
        );
      }
    );

    await context.test(
      "task update translates a P2025 not-found race and restores the row",
      async () => {
        const task = await prisma.task.create({ data: { title: "Racing task" } });
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER delete_task_before_update
          BEFORE UPDATE ON "Task"
          WHEN OLD.id = '${task.id.replaceAll("'", "''")}'
          BEGIN
            DELETE FROM "Task" WHERE id = OLD.id;
          END;
        `);

        const response = await patchTask(
          jsonRequest(`/api/tasks/${task.id}`, "PATCH", { title: "Changed" }),
          params(task.id)
        );
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), {
          error: "Task not found.",
          code: "NOT_FOUND"
        });
        assert.equal(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title,
          "Racing task",
          "the failed transaction must roll back the trigger's delete"
        );
        await prisma.$executeRawUnsafe("DROP TRIGGER delete_task_before_update");
      }
    );

    let pendingCompletion: Record<string, unknown>;
    await context.test(
      "concurrent Focus completion creates exactly one Activity",
      async () => {
        const session = await prisma.focusSession.create({
          data: {
            activeKey: 1,
            kind: "FOCUS",
            plannedMinutes: 25,
            label: "Concurrent completion",
            startedAt: new Date(Date.now() - 3 * 60_000)
          }
        });
        const request = () =>
          jsonRequest(`/api/focus-session/${session.id}`, "PATCH", {
            action: "complete"
          });

        const responses = await Promise.all([
          patchFocus(request(), params(session.id)),
          patchFocus(request(), params(session.id))
        ]);
        assert.deepEqual(
          responses.map((response) => response.status),
          [200, 200]
        );
        const persisted = await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } });
        const activity = await prisma.activityEntry.findUniqueOrThrow({ where: { focusSessionId: session.id } });
        pendingCompletion = {
          id: session.id,
          activeKey: null,
          kind: "FOCUS",
          plannedMinutes: 25,
          actualMinutes: 3,
          label: "Concurrent completion",
          startedAt: session.startedAt.toISOString(),
          pausedAt: null,
          accumulatedPauseSeconds: 0,
          status: "COMPLETED",
          completedAt: persisted.completedAt!.toISOString(),
          needsEnrichment: true,
          enrichedAt: null,
          completionNote: null,
          completionCategory: null,
          taskId: null,
          projectId: null,
          createdAt: session.createdAt.toISOString(),
          updatedAt: persisted.updatedAt.toISOString(),
          task: null,
          project: null,
          activity: { id: activity.id }
        };
        for (const response of responses) {
          const body = await response.json();
          assert.equal(body.completed, true);
          assert.deepEqual(body, {
            completed: true,
            suggestedBreakMinutes: 5,
            completedSession: pendingCompletion,
            snapshot: {
              active: null,
              pendingCompletion,
              today: { completedSessions: 1, focusedMinutes: 3 }
            }
          });
        }
        assert.equal(
          await prisma.activityEntry.count({
            where: { focusSessionId: session.id, origin: "FOCUS" }
          }),
          1
        );
        assert.equal(
          (await prisma.focusSession.findUniqueOrThrow({ where: { id: session.id } }))
            .status,
          "COMPLETED"
        );
      }
    );

    await context.test(
      "Focus enrichment completes its Task, consumes the queue, and reuses the Activity",
      async () => {
        context.mock.timers.tick(1_000);
        const task = await prisma.task.create({
          data: { title: "Enrich me", focusQueuePosition: 0 }
        });
        const session = await prisma.focusSession.create({
          data: {
            kind: "FOCUS",
            plannedMinutes: 25,
            actualMinutes: 12,
            label: "Enrichment",
            startedAt: new Date(Date.now() - 12 * 60_000),
            completedAt: new Date(),
            status: "COMPLETED",
            needsEnrichment: true,
            taskId: task.id
          }
        });
        const existingActivity = await prisma.activityEntry.create({
          data: {
            startedAt: session.startedAt,
            durationMinutes: 12,
            category: "Deep Work",
            note: "Enrich me",
            origin: "FOCUS",
            taskId: task.id,
            focusSessionId: session.id
          }
        });

        const response = await patchFocus(
          jsonRequest(`/api/focus-session/${session.id}`, "PATCH", {
            action: "enrich",
            note: "Shipped the seam",
            category: "Engineering",
            taskCompleted: true
          }),
          params(session.id)
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.completed, true);
        assert.equal(body.enriched, true);
        assert.equal(body.activity.id, existingActivity.id);
        const persistedActivity = await prisma.activityEntry.findUniqueOrThrow({ where: { id: existingActivity.id } });
        assert.deepEqual(body, {
          completed: true,
          enriched: true,
          activity: {
            id: existingActivity.id,
            startedAt: session.startedAt.toISOString(),
            durationMinutes: 12,
            category: "Engineering",
            note: "Shipped the seam",
            origin: "FOCUS",
            taskId: task.id,
            projectId: null,
            attributedProjectId: null,
            focusSessionId: session.id,
            createdAt: existingActivity.createdAt.toISOString(),
            updatedAt: persistedActivity.updatedAt.toISOString()
          },
          suggestedBreakMinutes: 5,
          completedSession: null,
          snapshot: {
            active: null,
            pendingCompletion,
            today: { completedSessions: 2, focusedMinutes: 15 }
          }
        });
        assert.deepEqual(
          await prisma.activityEntry.findUniqueOrThrow({
            where: { id: existingActivity.id }, select: { note: true, category: true }
          }),
          { note: "Shipped the seam", category: "Engineering" }
        );
        assert.equal(await prisma.activityEntry.count({ where: { focusSessionId: session.id } }), 1);
        assert.deepEqual(
          await prisma.task.findUniqueOrThrow({
            where: { id: task.id },
            select: { status: true, focusQueuePosition: true }
          }),
          { status: "DONE", focusQueuePosition: null }
        );
        assert.deepEqual(
          await prisma.focusSession.findUniqueOrThrow({
            where: { id: session.id },
            select: { needsEnrichment: true, completionNote: true, completionCategory: true }
          }),
          {
            needsEnrichment: false,
            completionNote: "Shipped the seam",
            completionCategory: "Engineering"
          }
        );
      }
    );

    await context.test(
      "zero-minute Focus and Break completion create no Activity",
      async () => {
        context.mock.timers.tick(1_000);
        let expectedPendingCompletion = pendingCompletion;
        for (const kind of ["FOCUS", "BREAK"] as const) {
          const session = await prisma.focusSession.create({
            data: {
              activeKey: 1,
              kind,
              plannedMinutes: kind === "FOCUS" ? 25 : 5,
              label: kind,
              startedAt: new Date()
            }
          });
          const response = await patchFocus(
            jsonRequest(`/api/focus-session/${session.id}`, "PATCH", {
              action: "complete"
            }),
            params(session.id)
          );
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.completed, true);
          if (kind === "FOCUS") {
            const persisted = await prisma.focusSession.findUniqueOrThrow({
              where: { id: session.id }
            });
            expectedPendingCompletion = {
              ...pendingCompletion,
              id: session.id,
              actualMinutes: 0,
              label: "FOCUS",
              startedAt: session.startedAt.toISOString(),
              completedAt: persisted.completedAt!.toISOString(),
              createdAt: session.createdAt.toISOString(),
              updatedAt: persisted.updatedAt.toISOString(),
              activity: null
            };
          }
          assert.deepEqual(body, {
            completed: true,
            suggestedBreakMinutes: kind === "FOCUS" ? 5 : null,
            completedSession: kind === "FOCUS" ? expectedPendingCompletion : null,
            snapshot: {
              active: null,
              pendingCompletion: expectedPendingCompletion,
              today: { completedSessions: 3, focusedMinutes: 15 }
            }
          });
          assert.equal(
            await prisma.activityEntry.count({ where: { focusSessionId: session.id } }),
            0
          );
        }
      }
    );

    await context.test(
      "Project completion with unfinished Tasks requires confirmation and changes nothing",
      async () => {
        const project = await prisma.project.create({ data: { name: "Incomplete" } });
        const task = await prisma.task.create({
          data: { title: "Still open", projectId: project.id }
        });
        const response = await patchProject(
          jsonRequest(`/api/projects/${project.id}`, "PATCH", {
            status: "COMPLETED"
          }),
          params(project.id)
        );
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
          error: "Confirm completion while unfinished tasks remain.",
          code: "CONFLICT",
          field: "status",
          requiresConfirmation: true
        });
        assert.equal(
          (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status,
          "ACTIVE"
        );
        assert.equal(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status,
          "TODO"
        );
      }
    );

    await context.test(
      "Project deletion detaches related records and deletes no user evidence",
      async () => {
        const project = await prisma.project.create({ data: { name: "Detach me" } });
        const phase = await prisma.projectPhase.create({
          data: { projectId: project.id, name: "Only phase" }
        });
        const task = await prisma.task.create({
          data: { title: "Surviving task", projectId: project.id, phaseId: phase.id }
        });
        const note = await prisma.note.create({
          data: { content: "Surviving note", date: new Date(), projectId: project.id }
        });
        const material = await prisma.material.create({
          data: {
            title: "Surviving reference",
            url: "https://example.com/reference",
            projectId: project.id
          }
        });
        const directActivity = await prisma.activityEntry.create({
          data: {
            startedAt: new Date(),
            durationMinutes: 10,
            category: "Work",
            note: "Direct",
            projectId: project.id,
            attributedProjectId: project.id
          }
        });

        const response = await deleteProject(
          new NextRequest(`http://localhost/api/projects/${project.id}?confirm=true`, {
            method: "DELETE"
          }),
          params(project.id)
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        assert.equal(await prisma.project.count({ where: { id: project.id } }), 0);
        assert.deepEqual(
          await prisma.task.findUniqueOrThrow({
            where: { id: task.id },
            select: { projectId: true, phaseId: true }
          }),
          { projectId: null, phaseId: null }
        );
        assert.equal(
          (await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).projectId,
          null
        );
        assert.equal(
          (await prisma.material.findUniqueOrThrow({ where: { id: material.id } }))
            .projectId,
          null
        );
        assert.deepEqual(
          await prisma.activityEntry.findUniqueOrThrow({
            where: { id: directActivity.id },
            select: { projectId: true, attributedProjectId: true }
          }),
          { projectId: null, attributedProjectId: null }
        );
        assert.equal(await prisma.task.count({ where: { id: task.id } }), 1);
        assert.equal(await prisma.note.count({ where: { id: note.id } }), 1);
        assert.equal(await prisma.material.count({ where: { id: material.id } }), 1);
        assert.equal(await prisma.activityEntry.count({ where: { id: directActivity.id } }), 1);
      }
    );

    await context.test(
      "Activity replace and delete protect Focus-origin evidence",
      async () => {
        const session = await prisma.focusSession.create({
          data: {
            kind: "FOCUS",
            plannedMinutes: 25,
            actualMinutes: 20,
            status: "COMPLETED"
          }
        });
        const activity = await prisma.activityEntry.create({
          data: {
            startedAt: new Date(),
            durationMinutes: 20,
            category: "Deep Work",
            note: "Protected",
            origin: "FOCUS",
            focusSessionId: session.id
          }
        });
        const replacement = await putActivity(
          jsonRequest(`/api/activities/${activity.id}`, "PUT", activityDraft()),
          params(activity.id)
        );
        assert.equal(replacement.status, 409);
        assert.deepEqual(await replacement.json(), {
          error: "Focus evidence cannot be edited here.",
          code: "FOCUS_ACTIVITY_PROTECTED"
        });

        assert.deepEqual(
          await prisma.activityEntry.findUniqueOrThrow({ where: { id: activity.id } }),
          activity,
          "rejected replacement must leave every persisted field unchanged"
        );
        const deletion = await deleteActivity(
          new NextRequest(`http://localhost/api/activities/${activity.id}`, {
            method: "DELETE"
          }),
          params(activity.id)
        );
        assert.equal(deletion.status, 409);
        assert.deepEqual(await deletion.json(), {
          error: "Focus evidence cannot be deleted."
        });
        assert.equal(await prisma.activityEntry.count({ where: { id: activity.id } }), 1);
      }
    );

    await context.test(
      "Activity replacement detects stale updatedAt and rolls back the competing write",
      async () => {
        const activity = await prisma.activityEntry.create({
          data: {
            startedAt: new Date(),
            durationMinutes: 15,
            category: "Admin",
            note: "Original"
          }
        });

        await assert.rejects(
          () =>
            prisma.$transaction(async (transaction) => {
              let firstRead = true;
              const instrumented = {
                ...transaction,
                activityEntry: {
                  ...transaction.activityEntry,
                  findUnique: async (args: Parameters<typeof transaction.activityEntry.findUnique>[0]) => {
                    const value = await transaction.activityEntry.findUnique(args);
                    if (firstRead && value) {
                      firstRead = false;
                      await transaction.activityEntry.update({
                        where: { id: activity.id },
                        data: { note: "Competing write" }
                      });
                    }
                    return value;
                  },
                  updateMany: (args: Parameters<typeof transaction.activityEntry.updateMany>[0]) =>
                    transaction.activityEntry.updateMany(args)
                }
              } as unknown as Prisma.TransactionClient;
              return replaceManualActivityInTransaction(
                instrumented,
                activity.id,
                activityDraft()
              );
            }),
          (error: unknown) =>
            error instanceof ActivityPersistenceError &&
            error.status === 409 &&
            error.code === "CONFLICT" &&
            error.message === "The Activity changed before it could be updated."
        );
        assert.deepEqual(
          await prisma.activityEntry.findUniqueOrThrow({
            where: { id: activity.id },
            select: { note: true, durationMinutes: true, category: true }
          }),
          { note: "Original", durationMinutes: 15, category: "Admin" },
          "both the replacement and the planted competing write must roll back"
        );
      }
    );
  });
});

function jsonRequest(
  path: string,
  method: "PATCH" | "PUT",
  body: Record<string, unknown>
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function activityDraft() {
  return {
    startTime: "09:30",
    durationMinutes: 30,
    category: "Deep Work",
    note: "Replacement",
    taskId: null,
    projectId: null
  };
}
