import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import {
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  readTask
} from "../../src/modules/planning/services/tasks";
import {
  parseTaskCreateMutation,
  parseTaskPatchInput,
  taskErrors
} from "../../src/modules/planning/domain/task";
import {
  createPhase,
  updatePhase,
  deletePhaseRecord,
  updateProject,
  validateProjectPlacement
} from "../../src/modules/projects/services/projects";
import { deletePhase } from "../../src/server/workflows/delete-phase";
import { completeProject } from "../../src/server/workflows/complete-project";
import { projectErrors } from "../../src/lib/project-errors";
import { AppError } from "../../src/shared/kernel/errors";
import { calendarFor, frozenClock } from "../../src/shared/kernel/calendar";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-lifecycle-test-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let disconnect: (() => Promise<void>) | undefined;
  process.env.DATABASE_URL = `file:${join(directory, "dayflow.db").split(sep).join("/")}`;
  context.after(async () => {
    try {
      await disconnect?.();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  execFileSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "db",
      "execute",
      "--file",
      "prisma/init.sql",
      "--url",
      process.env.DATABASE_URL
    ],
    { cwd: process.cwd(), stdio: "pipe" }
  );
  const [{ getPrisma }, { runOnce }] = await Promise.all([
    import("../../src/lib/prisma"),
    import("../../src/server/prisma/run-once")
  ]);
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  await run({ prisma, runOnce });
}

const clock = frozenClock(new Date("2026-09-04T12:00:00-05:00"));
const calendar = calendarFor("America/Chicago");
const reviewPeriod = {
  start: new Date("2026-08-31T00:00:00-05:00"),
  end: new Date("2026-09-07T00:00:00-05:00")
};

const draft = (changes: Record<string, unknown> = {}) =>
  parseTaskCreateMutation(
    { title: "Task title", date: "2026-09-04", ...changes },
    clock.now()
  );
const patch = (changes: Record<string, unknown>) =>
  parseTaskPatchInput(changes, clock.now());

function hasCompletedRejection(error: unknown) {
  assert.ok(error instanceof AppError, `Expected AppError, got: ${error}`);
  assert.deepEqual(
    error.spec,
    projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork
  );
  return true;
}

function hasArchivedRejection(error: unknown) {
  assert.ok(error instanceof AppError, `Expected AppError, got: ${error}`);
  assert.equal(error.spec.status, 409);
  assert.equal(error.spec.code, "RELATIONSHIP_CONFLICT");
  assert.equal(error.spec.field, "projectId");
  assert.match(error.spec.message, /restore|archived/i);
  return true;
}

function hasSpec(spec: AppError["spec"]) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError, `Expected AppError, got: ${error}`);
    assert.deepEqual(error.spec, spec);
    return true;
  };
}

test("Project Lifecycle Policy: Task Mutations in COMPLETED and ARCHIVED projects", async (context) => {
  await withDatabase(context, async ({ prisma }) => {
    const create = (changes: Record<string, unknown> = {}) =>
      prisma.$transaction((tx) => createTask(tx, draft(changes)));
    const update = (id: string, changes: Record<string, unknown>) =>
      prisma.$transaction((tx) =>
        updateTask(tx, id, patch(changes), calendar, clock.now())
      );

    const active = await prisma.project.create({
      data: { name: "Active project", status: "ACTIVE" }
    });
    const paused = await prisma.project.create({
      data: { name: "Paused project", status: "PAUSED" }
    });
    const completed = await prisma.project.create({
      data: { name: "Completed project", status: "COMPLETED" }
    });
    const archived = await prisma.project.create({
      data: { name: "Archived project", status: "ARCHIVED" }
    });

    const activePhase = await prisma.$transaction((tx) =>
      createPhase(tx, active.id, { name: "Active phase" })
    );
    const completedPhase = await prisma.projectPhase.create({
      data: { projectId: completed.id, name: "Completed phase", sortOrder: 1 }
    });
    const archivedPhase = await prisma.projectPhase.create({
      data: { projectId: archived.id, name: "Archived phase", sortOrder: 1 }
    });

    // -------------------------------------------------------------------------
    // Priority 1.1: Unfinished Task Creation
    // -------------------------------------------------------------------------
    await context.test(
      "creating unfinished tasks is rejected in COMPLETED and ARCHIVED, but allowed in ACTIVE and PAUSED",
      async () => {
        // COMPLETED rejects unfinished task create
        await assert.rejects(
          () => create({ projectId: completed.id, status: "TODO" }),
          hasCompletedRejection
        );

        // ARCHIVED rejects unfinished task create
        await assert.rejects(
          () => create({ projectId: archived.id, status: "TODO" }),
          hasArchivedRejection
        );

        // ACTIVE allows unfinished task create
        const activeTask = await create({ projectId: active.id, status: "TODO" });
        assert.equal(activeTask.projectId, active.id);
        assert.equal(activeTask.status, "TODO");

        // PAUSED allows unfinished task create
        const pausedTask = await create({ projectId: paused.id, status: "TODO" });
        assert.equal(pausedTask.projectId, paused.id);
        assert.equal(pausedTask.status, "TODO");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.2: Already-DONE Task Creation
    // -------------------------------------------------------------------------
    await context.test(
      "creating already-DONE tasks is allowed in all states including COMPLETED and ARCHIVED",
      async () => {
        const doneCompleted = await create({
          projectId: completed.id,
          status: "DONE"
        });
        assert.equal(doneCompleted.projectId, completed.id);
        assert.equal(doneCompleted.status, "DONE");

        const doneArchived = await create({
          projectId: archived.id,
          status: "DONE"
        });
        assert.equal(doneArchived.projectId, archived.id);
        assert.equal(doneArchived.status, "DONE");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.3: Moving Tasks In (Placement Changes)
    // -------------------------------------------------------------------------
    await context.test(
      "moving unfinished tasks INTO COMPLETED or ARCHIVED is rejected, while moving already-DONE is allowed",
      async () => {
        // Unfinished standalone task
        const standaloneTodo = await create({ status: "TODO" });
        assert.equal(standaloneTodo.projectId, null);

        // Moving unfinished task into COMPLETED rejected
        await assert.rejects(
          () => update(standaloneTodo.id, { projectId: completed.id }),
          hasCompletedRejection
        );

        // Moving unfinished task into ARCHIVED rejected
        await assert.rejects(
          () => update(standaloneTodo.id, { projectId: archived.id }),
          hasArchivedRejection
        );

        // Task remains unaffected at null project
        const unchanged = await readTask(prisma, standaloneTodo.id);
        assert.equal(unchanged?.projectId, null);

        // Standalone DONE task
        const standaloneDone = await create({ status: "DONE" });
        assert.equal(standaloneDone.projectId, null);

        // Moving already-DONE task into COMPLETED succeeds
        const movedToCompleted = await update(standaloneDone.id, {
          projectId: completed.id
        });
        assert.equal(movedToCompleted.projectId, completed.id);
        assert.equal(movedToCompleted.status, "DONE");

        // Moving already-DONE task into ARCHIVED succeeds
        const standaloneDone2 = await create({ status: "DONE" });
        const movedToArchived = await update(standaloneDone2.id, {
          projectId: archived.id
        });
        assert.equal(movedToArchived.projectId, archived.id);
        assert.equal(movedToArchived.status, "DONE");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.4: DONE -> TODO Reopening Transitions
    // -------------------------------------------------------------------------
    await context.test(
      "reopening (DONE -> TODO) within COMPLETED or ARCHIVED is rejected",
      async () => {
        const doneInCompleted = await create({
          projectId: completed.id,
          status: "DONE"
        });
        await assert.rejects(
          () => update(doneInCompleted.id, { status: "TODO" }),
          hasCompletedRejection
        );

        const doneInArchived = await create({
          projectId: archived.id,
          status: "DONE"
        });
        await assert.rejects(
          () => update(doneInArchived.id, { status: "TODO" }),
          hasArchivedRejection
        );

        // In ACTIVE project, reopening is allowed
        const doneInActive = await create({
          projectId: active.id,
          status: "DONE"
        });
        const reopenedActive = await update(doneInActive.id, { status: "TODO" });
        assert.equal(reopenedActive.status, "TODO");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.5: TODO -> DONE Completion of Existing Tasks
    // -------------------------------------------------------------------------
    await context.test(
      "completing an existing TODO task (TODO -> DONE) succeeds in COMPLETED and ARCHIVED",
      async () => {
        // Direct seed of existing TODO task left over in completed project
        const leftoverCompleted = await prisma.task.create({
          data: {
            title: "Leftover in completed",
            status: "TODO",
            projectId: completed.id
          }
        });
        const completedResult = await update(leftoverCompleted.id, {
          status: "DONE"
        });
        assert.equal(completedResult.status, "DONE");
        assert.equal(completedResult.completedAt, clock.now().toISOString());

        // Direct seed of existing TODO task in archived project
        const leftoverArchived = await prisma.task.create({
          data: {
            title: "Leftover in archived",
            status: "TODO",
            projectId: archived.id
          }
        });
        const archivedResult = await update(leftoverArchived.id, {
          status: "DONE"
        });
        assert.equal(archivedResult.status, "DONE");
        assert.equal(archivedResult.completedAt, clock.now().toISOString());
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.6: Same-Project Non-Status Updates (Rename, Re-phase, Schedule)
    // -------------------------------------------------------------------------
    await context.test(
      "same-project TODO updates (rename, identical projectId, re-phase, schedule) succeed in COMPLETED and ARCHIVED",
      async () => {
        // Lingering TODO task in completed project
        const existingTodo = await prisma.task.create({
          data: {
            title: "Original title",
            status: "TODO",
            projectId: completed.id,
            date: new Date("2026-09-04T12:00:00.000Z")
          }
        });

        // 1. Rename without projectId
        const renamed = await update(existingTodo.id, {
          title: "Corrected title"
        });
        assert.equal(renamed.title, "Corrected title");
        assert.equal(renamed.projectId, completed.id);
        assert.equal(renamed.status, "TODO");

        // 2. Rename with identical explicit projectId supplied
        const renamedExplicit = await update(existingTodo.id, {
          title: "Corrected title 2",
          projectId: completed.id
        });
        assert.equal(renamedExplicit.title, "Corrected title 2");
        assert.equal(renamedExplicit.projectId, completed.id);

        // 3. Re-phase within same project
        const rephased = await update(existingTodo.id, {
          phaseId: completedPhase.id
        });
        assert.equal(rephased.phaseId, completedPhase.id);
        assert.equal(rephased.projectId, completed.id);

        // 4. Reschedule date
        const rescheduled = await update(existingTodo.id, {
          date: "2026-09-10"
        });
        assert.ok(rescheduled.date?.startsWith("2026-09-10"));

        // 5. Unschedule (backlog)
        const unscheduled = await update(existingTodo.id, { date: null });
        assert.equal(unscheduled.date, null);

        // Repeat on ARCHIVED project
        const existingArchivedTodo = await prisma.task.create({
          data: {
            title: "Original archived title",
            status: "TODO",
            projectId: archived.id,
            date: new Date("2026-09-04T12:00:00.000Z")
          }
        });

        const renamedArchived = await update(existingArchivedTodo.id, {
          title: "Corrected archived title",
          projectId: archived.id,
          phaseId: archivedPhase.id,
          date: "2026-09-11"
        });
        assert.equal(renamedArchived.title, "Corrected archived title");
        assert.equal(renamedArchived.projectId, archived.id);
        assert.equal(renamedArchived.phaseId, archivedPhase.id);
        assert.ok(renamedArchived.date?.startsWith("2026-09-11"));
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.7: Moving Unfinished Tasks OUT of Completed / Archived
    // -------------------------------------------------------------------------
    await context.test(
      "moving unfinished tasks OUT of COMPLETED or ARCHIVED into ACTIVE or null succeeds",
      async () => {
        const inCompleted = await prisma.task.create({
          data: {
            title: "Move out of completed",
            status: "TODO",
            projectId: completed.id
          }
        });
        const movedToActive = await update(inCompleted.id, {
          projectId: active.id
        });
        assert.equal(movedToActive.projectId, active.id);
        assert.equal(movedToActive.status, "TODO");

        const inArchived = await prisma.task.create({
          data: {
            title: "Move out of archived",
            status: "TODO",
            projectId: archived.id
          }
        });
        const movedToNull = await update(inArchived.id, { projectId: null });
        assert.equal(movedToNull.projectId, null);
        assert.equal(movedToNull.status, "TODO");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.8: Task Deletion and Reordering
    // -------------------------------------------------------------------------
    await context.test(
      "deleting and reordering tasks is allowed in COMPLETED and ARCHIVED",
      async () => {
        for (const [project, label] of [
          [completed, "COMPLETED"],
          [archived, "ARCHIVED"]
        ] as const) {
          // Reordering DONE tasks
          const t1 = await prisma.task.create({
            data: {
              title: `${label} T1`,
              status: "DONE",
              projectId: project.id,
              sortOrder: 1
            }
          });
          const t2 = await prisma.task.create({
            data: {
              title: `${label} T2`,
              status: "DONE",
              projectId: project.id,
              sortOrder: 2
            }
          });

          const reordered = await prisma.$transaction((tx) =>
            reorderTasks(tx, [t2.id, t1.id])
          );
          assert.deepEqual(
            reordered.map((t) => [t.id, t.sortOrder]),
            [
              [t2.id, 1],
              [t1.id, 2]
            ],
            `Failed to reorder DONE tasks in ${label}`
          );

          // Reordering existing TODO tasks without triggering unfinished gain
          const todo1 = await prisma.task.create({
            data: {
              title: `${label} Todo 1`,
              status: "TODO",
              projectId: project.id,
              sortOrder: 3
            }
          });
          const todo2 = await prisma.task.create({
            data: {
              title: `${label} Todo 2`,
              status: "TODO",
              projectId: project.id,
              sortOrder: 4
            }
          });
          const reorderedTodos = await prisma.$transaction((tx) =>
            reorderTasks(tx, [todo2.id, todo1.id])
          );
          assert.deepEqual(
            reorderedTodos.map((t) => [t.id, t.sortOrder]),
            [
              [todo2.id, 1],
              [todo1.id, 2]
            ],
            `Failed to reorder TODO tasks in ${label}`
          );

          // Deleting DONE task
          const deleteDoneResult = await prisma.$transaction((tx) =>
            deleteTask(tx, t1.id)
          );
          assert.deepEqual(deleteDoneResult, { ok: true });
          assert.equal(await readTask(prisma, t1.id), null);

          // Deleting TODO task
          const deleteTodoResult = await prisma.$transaction((tx) =>
            deleteTask(tx, todo1.id)
          );
          assert.deepEqual(deleteTodoResult, { ok: true });
          assert.equal(await readTask(prisma, todo1.id), null);
        }
      }
    );

    // -------------------------------------------------------------------------
    // Priority 1.9: Destination and Relationship Integrity Preservation
    // -------------------------------------------------------------------------
    await context.test(
      "relationship integrity (missing project, phase mismatch) is preserved and not masked by lifecycle guards",
      async () => {
        // Use already-DONE tasks so lifecycle guards do not trigger or mask phase/project checks
        const existingDone = await create({ status: "DONE" });

        // Missing project check (404 RELATIONSHIP_NOT_FOUND)
        await assert.rejects(
          () => create({ projectId: "missing-project-id", status: "DONE" }),
          (error: unknown) => {
            assert.ok(error instanceof AppError);
            assert.equal(error.status, 404);
            assert.equal(error.code, "RELATIONSHIP_NOT_FOUND");
            assert.equal(error.field, "projectId");
            assert.equal(error.message, "The selected project could not be found.");
            return true;
          }
        );
        await assert.rejects(
          () => update(existingDone.id, { projectId: "missing-project-id" }),
          (error: unknown) => {
            assert.ok(error instanceof AppError);
            assert.equal(error.status, 404);
            assert.equal(error.code, "RELATIONSHIP_NOT_FOUND");
            assert.equal(error.field, "projectId");
            assert.equal(error.message, "The selected project could not be found.");
            return true;
          }
        );

        // Missing phase check in COMPLETED and ARCHIVED (404 RELATIONSHIP_NOT_FOUND)
        for (const targetProject of [completed, archived]) {
          await assert.rejects(
            () =>
              create({
                projectId: targetProject.id,
                phaseId: "missing-phase-id",
                status: "DONE"
              }),
            (error: unknown) => {
              assert.ok(error instanceof AppError);
              assert.equal(error.status, 404);
              assert.equal(error.code, "RELATIONSHIP_NOT_FOUND");
              assert.equal(error.field, "phaseId");
              assert.equal(error.message, "The selected phase could not be found.");
              return true;
            }
          );
        }

        // Cross-project phase mismatch on CREATE of DONE task (409 RELATIONSHIP_CONFLICT)
        // Lifecycle guard allows DONE tasks, so phase membership check runs directly.
        for (const targetProject of [completed, archived]) {
          await assert.rejects(
            () =>
              create({
                projectId: targetProject.id,
                phaseId: activePhase.id,
                status: "DONE"
              }),
            (error: unknown) => {
              assert.ok(error instanceof AppError);
              assert.equal(error.status, 409);
              assert.equal(error.code, "RELATIONSHIP_CONFLICT");
              assert.equal(error.field, "phaseId");
              assert.equal(
                error.message,
                "The selected phase does not belong to this project."
              );
              return true;
            }
          );
        }

        // Cross-project phase mismatch on UPDATE of existing same-project TODO task
        // Because the task is already in the project, gainsUnfinishedTask returns false.
        // Thus, lifecycle guard does NOT fire, and phase membership check is verified.
        const sameProjectCompletedTodo = await prisma.task.create({
          data: {
            title: "Existing Completed Todo",
            status: "TODO",
            projectId: completed.id
          }
        });
        await assert.rejects(
          () =>
            update(sameProjectCompletedTodo.id, {
              phaseId: activePhase.id
            }),
          (error: unknown) => {
            assert.ok(error instanceof AppError);
            assert.equal(error.status, 409);
            assert.equal(error.code, "RELATIONSHIP_CONFLICT");
            assert.equal(error.field, "phaseId");
            assert.equal(
              error.message,
              "The selected phase does not belong to this project."
            );
            return true;
          }
        );

        const sameProjectArchivedTodo = await prisma.task.create({
          data: {
            title: "Existing Archived Todo",
            status: "TODO",
            projectId: archived.id
          }
        });
        await assert.rejects(
          () =>
            update(sameProjectArchivedTodo.id, {
              phaseId: activePhase.id
            }),
          (error: unknown) => {
            assert.ok(error instanceof AppError);
            assert.equal(error.status, 409);
            assert.equal(error.code, "RELATIONSHIP_CONFLICT");
            assert.equal(error.field, "phaseId");
            assert.equal(
              error.message,
              "The selected phase does not belong to this project."
            );
            return true;
          }
        );
      }
    );
  });
});

test("Project Lifecycle Policy: Phase CRUD in COMPLETED and ARCHIVED projects", async (context) => {
  await withDatabase(context, async ({ prisma }) => {
    const completed = await prisma.project.create({
      data: { name: "Completed Phase Target", status: "COMPLETED" }
    });
    const archived = await prisma.project.create({
      data: { name: "Archived Phase Target", status: "ARCHIVED" }
    });

    // -------------------------------------------------------------------------
    // Priority 2.1: Empty Phase Creation in Completed and Archived
    // -------------------------------------------------------------------------
    await context.test(
      "creating phases (including empty) succeeds in COMPLETED and ARCHIVED",
      async () => {
        // COMPLETED project phase create
        const completedPhase = await prisma.$transaction((tx) =>
          createPhase(tx, completed.id, { name: "Retrospective Phase" })
        );
        assert.equal(completedPhase.projectId, completed.id);
        assert.equal(completedPhase.name, "Retrospective Phase");

        // ARCHIVED project phase create
        const archivedPhase = await prisma.$transaction((tx) =>
          createPhase(tx, archived.id, { name: "Archived Phase 1" })
        );
        assert.equal(archivedPhase.projectId, archived.id);
        assert.equal(archivedPhase.name, "Archived Phase 1");
      }
    );

    // -------------------------------------------------------------------------
    // Priority 2.2: Phase Rename in Completed and Archived
    // -------------------------------------------------------------------------
    // Phases and tasks are seeded directly, so a failure here belongs to the
    // rename or deletion itself rather than to phase creation.
    await context.test(
      "renaming a phase in COMPLETED or ARCHIVED changes only its name and keeps its tasks",
      async () => {
        for (const [project, label] of [
          [completed, "COMPLETED"],
          [archived, "ARCHIVED"]
        ] as const) {
          const phase = await prisma.projectPhase.create({
            data: { projectId: project.id, name: `Before rename ${label}`, sortOrder: 10 }
          });
          const unfinished = await prisma.task.create({
            data: {
              title: `Unfinished in renamed ${label} phase`,
              status: "TODO",
              projectId: project.id,
              phaseId: phase.id
            }
          });
          const done = await prisma.task.create({
            data: {
              title: `Done in renamed ${label} phase`,
              status: "DONE",
              completedAt: new Date("2026-09-03T12:00:00.000Z"),
              projectId: project.id,
              phaseId: phase.id
            }
          });

          const renamed = await prisma.$transaction((tx) =>
            updatePhase(tx, phase.id, { name: `After rename ${label}` })
          );

          assert.equal(renamed.name, `After rename ${label}`);
          const persisted = await prisma.projectPhase.findUniqueOrThrow({
            where: { id: phase.id }
          });
          assert.deepEqual(
            { ...persisted, updatedAt: phase.updatedAt },
            { ...phase, name: `After rename ${label}` },
            `${label}: renaming must change only the phase name`
          );
          for (const task of [unfinished, done]) {
            assert.deepEqual(
              await prisma.task.findUnique({ where: { id: task.id } }),
              task,
              `${label}: renaming the phase must leave "${task.title}" untouched`
            );
          }
        }
      }
    );

    // -------------------------------------------------------------------------
    // Priority 2.3: Phase Deletion Moves Tasks to Root and Preserves Attribution
    // -------------------------------------------------------------------------
    await context.test(
      "deleting a phase in COMPLETED or ARCHIVED moves only its own tasks to the project root",
      async () => {
        for (const [project, label] of [
          [completed, "COMPLETED"],
          [archived, "ARCHIVED"]
        ] as const) {
          const phase = await prisma.projectPhase.create({
            data: { projectId: project.id, name: `Deleted ${label} phase`, sortOrder: 20 }
          });
          const kept = await prisma.projectPhase.create({
            data: { projectId: project.id, name: `Kept ${label} phase`, sortOrder: 21 }
          });
          const unfinished = await prisma.task.create({
            data: {
              title: `Unfinished in deleted ${label} phase`,
              status: "TODO",
              date: new Date("2026-09-04T12:00:00.000Z"),
              projectId: project.id,
              phaseId: phase.id
            }
          });
          const done = await prisma.task.create({
            data: {
              title: `Done in deleted ${label} phase`,
              status: "DONE",
              completedAt: new Date("2026-09-03T12:00:00.000Z"),
              projectId: project.id,
              phaseId: phase.id
            }
          });
          const elsewhere = await prisma.task.create({
            data: {
              title: `Unfinished in kept ${label} phase`,
              status: "TODO",
              projectId: project.id,
              phaseId: kept.id
            }
          });

          await deletePhase(phase.id);

          assert.equal(
            await prisma.projectPhase.findUnique({ where: { id: phase.id } }),
            null,
            `${label}: the phase was not deleted`
          );
          assert.ok(
            await prisma.projectPhase.findUnique({ where: { id: kept.id } }),
            `${label}: deleting one phase removed another`
          );
          for (const task of [unfinished, done]) {
            const after = await prisma.task.findUnique({ where: { id: task.id } });
            assert.ok(after, `${label}: "${task.title}" was deleted with its phase`);
            assert.deepEqual(
              { ...after, updatedAt: task.updatedAt },
              { ...task, phaseId: null },
              `${label}: deleting the phase must move "${task.title}" to the root and change nothing else`
            );
          }
          assert.deepEqual(
            await prisma.task.findUnique({ where: { id: elsewhere.id } }),
            elsewhere,
            `${label}: a task in another phase must be untouched`
          );
        }
      }
    );
  });
});

test("Project Lifecycle Policy: Project Status Transitions and Form Preservation", async (context) => {
  await withDatabase(context, async ({ prisma }) => {
    const archived = await prisma.project.create({
      data: {
        name: "Preserve Archived",
        status: "ARCHIVED",
        desiredOutcome: "Unchanged"
      }
    });

    const completed = await prisma.project.create({
      data: {
        name: "Completed Project",
        status: "COMPLETED",
        desiredOutcome: "Finished"
      }
    });

    // -------------------------------------------------------------------------
    // Priority 4: Ordinary Edits Preserve ARCHIVED; Explicit Restoration to ACTIVE
    // -------------------------------------------------------------------------
    await context.test(
      "ordinary edits preserve ARCHIVED status, while explicit restore/reopen sets ACTIVE",
      async () => {
        // Unrelated edit on ARCHIVED project (e.g. updating name or desiredOutcome)
        const patchResult = await completeProject(
          archived.id,
          {
            data: { desiredOutcome: "Updated Outcome" },
            confirmCompletion: false
          },
          reviewPeriod
        );
        assert.equal(patchResult.kind, "saved");
        if (patchResult.kind === "saved") {
          assert.equal(patchResult.detail.status, "ARCHIVED");
          assert.equal(patchResult.detail.desiredOutcome, "Updated Outcome");
        }

        // Explicit restoration to ACTIVE
        const restoreResult = await completeProject(
          archived.id,
          {
            data: { status: "ACTIVE" },
            confirmCompletion: false
          },
          reviewPeriod
        );
        assert.equal(restoreResult.kind, "saved");
        if (restoreResult.kind === "saved") {
          assert.equal(restoreResult.detail.status, "ACTIVE");
        }

        // Ordinary edit on COMPLETED project preserves COMPLETED
        const editCompleted = await completeProject(
          completed.id,
          {
            data: { name: "Completed Renamed" },
            confirmCompletion: false
          },
          reviewPeriod
        );
        assert.equal(editCompleted.kind, "saved");
        if (editCompleted.kind === "saved") {
          assert.equal(editCompleted.detail.status, "COMPLETED");
          assert.equal(editCompleted.detail.name, "Completed Renamed");
        }

        // Explicit reopen of COMPLETED to ACTIVE
        const reopenCompleted = await completeProject(
          completed.id,
          {
            data: { status: "ACTIVE" },
            confirmCompletion: false
          },
          reviewPeriod
        );
        assert.equal(reopenCompleted.kind, "saved");
        if (reopenCompleted.kind === "saved") {
          assert.equal(reopenCompleted.detail.status, "ACTIVE");
        }
      }
    );
  });
});
