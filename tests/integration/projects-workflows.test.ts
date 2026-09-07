import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { parseProjectCreateMutation, parseProjectPatchMutation, projectErrors, isProjectDetailResponse } from "../../src/modules/projects/domain/project";
import { createProject, updateProject, createPhase, updatePhase, validateProjectPlacement, translateProjectPersistenceError } from "../../src/modules/projects/services/projects";
import { completeProject } from "../../src/server/workflows/complete-project";
import { deleteProject } from "../../src/server/workflows/delete-project";
import { deletePhase } from "../../src/server/workflows/delete-phase";
import { getProjectDetail } from "../../src/server/read-models/project-detail";
import { listProjectSummaries } from "../../src/server/read-models/project-summaries";
import { AppError } from "../../src/shared/kernel/errors";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-projects-test-"));
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
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "db", "execute", "--file", "prisma/init.sql", "--url", process.env.DATABASE_URL
  ], { cwd: process.cwd(), stdio: "pipe" });
  // Load the transaction root only after directing its client at disposable SQLite.
  const [{ getPrisma }, { runOnce }] = await Promise.all([
    import("../../src/lib/prisma"),
    import("../../src/server/prisma/run-once")
  ]);
  const prisma = getPrisma();
  disconnect = () => prisma.$disconnect();
  await run({ prisma, runOnce });
}

// Wrap rows only after the real query returns, so counters measure read-model work.
function countRowKeys(database: Prisma.TransactionClient, keys: Record<string, string>) {
  const rows: Record<string, number> = {};
  const reads: Record<string, number> = {};
  return { rows, reads, database: new Proxy(database, {
    get(target, property, receiver) {
      const delegate = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !keys[property]) return delegate;
      return new Proxy(delegate, {
        get(targetDelegate, method) {
          if (method !== "findMany") return Reflect.get(targetDelegate, method);
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(targetDelegate.findMany, targetDelegate, args);
            assert.ok(Array.isArray(result));
            rows[property] = (rows[property] ?? 0) + result.length;
            reads[property] ??= 0;
            return result.map((row: object) => new Proxy(row, {
              get(record, key, recordReceiver) {
                if (key === keys[property]) reads[property]++;
                return Reflect.get(record, key, recordReceiver);
              }
            }));
          };
        }
      });
    }
  }) };
}

const period = { start: new Date("2026-08-29T05:00:00Z"), end: new Date("2026-09-05T05:00:00Z") };
const draft = (name = "Project") => parseProjectCreateMutation({ name });
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function hasSpec(spec: AppError["spec"]) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.deepEqual(error.spec, spec);
    return true;
  };
}

test("projects services and server workflows run headlessly on SQLite", async (context) => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const create = (name = "Project") => prisma.$transaction(tx => createProject(tx, draft(name)));
    const reset = async () => {
      await prisma.mutationReceipt.deleteMany();
      await prisma.activityEntry.deleteMany();
      await prisma.material.deleteMany();
      await prisma.note.deleteMany();
      await prisma.task.deleteMany();
      await prisma.project.deleteMany();
    };

    await context.test("create receipt replays the original detail after updates and deletion; receipt failure rolls back", async () => {
      let calls = 0;
      const options = { mutationId: "project-replay", kind: "project.create", payload: { name: "Project" },
        create: async (tx: Prisma.TransactionClient) => {
          calls++;
          const project = await createProject(tx, draft());
          return getProjectDetail(tx, project.id, period);
        } };
      const first = await runOnce(options);
      assert.ok(first);
      assert.ok(isProjectDetailResponse(json(first)));
      await prisma.$transaction(tx => updateProject(tx, first.id, parseProjectPatchMutation({ name: "Renamed", weeklyMinutesBudget: 120 }).data));
      const updated = await prisma.project.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(updated.name, "Renamed");
      assert.equal(updated.weeklyMinutesBudget, 120);
      assert.equal(updated.desiredOutcome, first.desiredOutcome);
      assert.deepEqual(await runOnce(options), json(first));
      await deleteProject(first.id);
      assert.deepEqual(await runOnce(options), json(first));
      assert.equal(calls, 1);
      await assert.rejects(() => runOnce({ ...options, payload: { name: "Changed" } }), (error: unknown) => error instanceof AppError && error.code === "MUTATION_ID_CONFLICT");
      await reset();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_project_receipt BEFORE INSERT ON "MutationReceipt"
        BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
      try {
        await assert.rejects(() => runOnce(options));
        assert.equal(await prisma.project.count(), 0);
        assert.equal(await prisma.mutationReceipt.count(), 0);
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_project_receipt"); }
    });

    await context.test("runOnce recovers a real P2002 receipt race and rolls back the losing Project", async () => {
      const { mutationRequestHash } = await import("../../src/server/prisma/run-once");
      const payload = { name: "Receipt race" };
      const winner = await create(payload.name);
      await prisma.mutationReceipt.create({ data: {
        id: "project-receipt-race", kind: "project.create",
        requestHash: mutationRequestHash("project.create", payload), responseJson: JSON.stringify(winner)
      } });
      const originalTransaction = prisma.$transaction;
      let staleReads = 0;
      let creates = 0;
      let failureCode: string | undefined;
      // Deterministically hide the committed winner only from the transaction's
      // initial lookup. SQLite itself raises P2002 at receipt insertion; the
      // recovery lookup sees the real committed receipt after rollback.
      prisma.$transaction = (async (operation: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<unknown>) => {
        try {
          return await originalTransaction.call(prisma, async (tx) => operation(new Proxy(tx, {
            get(target, property) {
              if (property !== "mutationReceipt") return Reflect.get(target, property);
              return new Proxy(target.mutationReceipt, {
                get(delegate, method) {
                  if (method === "findUnique") return async () => { staleReads++; return null; };
                  return Reflect.get(delegate, method);
                }
              });
            }
          })));
        } catch (error) {
          if (error instanceof Error && "code" in error) failureCode = String(error.code);
          throw error;
        }
      }) as typeof prisma.$transaction;
      try {
        const recovered = await runOnce({
          mutationId: "project-receipt-race", kind: "project.create", payload,
          create: (tx) => { creates++; return createProject(tx, parseProjectCreateMutation(payload)); }
        });
        assert.deepEqual(recovered, json(winner));
        assert.equal(failureCode, "P2002");
        assert.equal(staleReads, 1);
        assert.equal(creates, 1);
        assert.equal(await prisma.project.count(), 1);
        assert.equal(await prisma.mutationReceipt.count(), 1);
        assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: winner.id } }), winner);
      } finally {
        prisma.$transaction = originalTransaction;
      }
      await reset();
    });

    await context.test("completion counts unfinished tasks before any patch and requires confirmation", async () => {
      const project = await create();
      const task = await prisma.task.create({ data: { title: "Open", projectId: project.id } });
      const result = await completeProject(project.id, parseProjectPatchMutation({ status: "COMPLETED", name: "Changed" }), period);
      assert.deepEqual(result, { kind: "confirmation-required" });
      assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: project.id } }), project);
      assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), task);
      const saved = await completeProject(project.id, parseProjectPatchMutation({ status: "COMPLETED", confirm: true, name: "Changed" }), period);
      assert.equal(saved.kind, "saved");
      assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status, "COMPLETED");
      assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), task);
      const empty = await create("Empty");
      assert.equal((await completeProject(empty.id, parseProjectPatchMutation({ status: "COMPLETED" }), period)).kind, "saved");
      assert.deepEqual(await completeProject("missing", parseProjectPatchMutation({ status: "COMPLETED" }), period), { kind: "not-found" });
      await reset();
    });

    await context.test("deletion detaches direct and attributed references while preserving every other field", async () => {
      const project = await create();
      const other = await create("Untouched");
      const phase = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Phase" }));
      const task = await prisma.task.create({ data: { title: "Keep task", projectId: project.id, phaseId: phase.id, focusQueuePosition: 0 } });
      const note = await prisma.note.create({ data: { content: "Keep note", tags: '["tag"]', date: period.start, projectId: project.id, taskId: task.id } });
      const material = await prisma.material.create({ data: { title: "Keep material", url: "https://example.com", projectId: project.id, taskId: task.id, noteId: note.id } });
      const activities = [];
      for (const [projectId, attributedProjectId] of [[project.id, project.id], [null, project.id], [project.id, other.id], [other.id, other.id]]) {
        activities.push(await prisma.activityEntry.create({ data: { startedAt: period.start, durationMinutes: 15, category: "Work", note: "Keep evidence", projectId, attributedProjectId, taskId: task.id } }));
      }
      const withoutUpdated = <T extends { updatedAt: Date }>({ updatedAt: _updatedAt, ...record }: T) => record;
      // Fail at the final delete after all detaches and prove the entire workflow rolls back.
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_project_delete BEFORE DELETE ON "Project"
        BEGIN SELECT RAISE(ABORT, 'delete unavailable'); END;`);
      try {
        await assert.rejects(() => deleteProject(project.id));
        assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), task);
        assert.deepEqual(await prisma.note.findUniqueOrThrow({ where: { id: note.id } }), note);
        assert.deepEqual(await prisma.material.findUniqueOrThrow({ where: { id: material.id } }), material);
        assert.deepEqual(await prisma.activityEntry.findMany({ orderBy: { createdAt: "asc" } }), activities);
        assert.equal(await prisma.projectPhase.count(), 1);
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_project_delete"); }
      await deleteProject(project.id);
      assert.equal(await prisma.projectPhase.count(), 0);
      assert.equal(await prisma.project.count(), 1);
      assert.deepEqual(withoutUpdated(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })), withoutUpdated({ ...task, projectId: null, phaseId: null }));
      assert.deepEqual(withoutUpdated(await prisma.note.findUniqueOrThrow({ where: { id: note.id } })), withoutUpdated({ ...note, projectId: null }));
      assert.deepEqual(withoutUpdated(await prisma.material.findUniqueOrThrow({ where: { id: material.id } })), withoutUpdated({ ...material, projectId: null }));
      for (const activity of activities) {
        const expected = activity.projectId === project.id || activity.attributedProjectId === project.id
          ? { ...activity, projectId: null, attributedProjectId: null } : activity;
        assert.deepEqual(withoutUpdated(await prisma.activityEntry.findUniqueOrThrow({ where: { id: activity.id } })), withoutUpdated(expected));
      }
      await assert.rejects(() => deleteProject(project.id), hasSpec(projectErrors.projectNotFound));
      await reset();
    });

    await context.test("phases append, replay, rename, reorder and detach tasks atomically on deletion", async () => {
      const project = await create();
      const options = { mutationId: "phase-replay", kind: "phase.create", payload: { projectId: project.id, name: "First" },
        create: (tx: Prisma.TransactionClient) => createPhase(tx, project.id, { name: "First" }) };
      const first = await runOnce(options);
      assert.deepEqual(await runOnce(options), json(first));
      const second = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Second" }));
      assert.equal(first.sortOrder, 1);
      assert.equal(second.sortOrder, 2);
      const renamed = await prisma.$transaction(tx => updatePhase(tx, second.id, { name: "Renamed", sortOrder: 0 }));
      assert.equal(renamed.name, "Renamed");
      assert.equal(renamed.sortOrder, 0);
      const task = await prisma.task.create({ data: { title: "Keep", projectId: project.id, phaseId: first.id } });
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_phase_delete BEFORE DELETE ON "ProjectPhase"
        BEGIN SELECT RAISE(ABORT, 'delete unavailable'); END;`);
      try {
        await assert.rejects(() => deletePhase(first.id));
        assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), task);
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_phase_delete"); }
      await deletePhase(first.id);
      const detached = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.deepEqual({ ...detached, updatedAt: task.updatedAt }, { ...task, phaseId: null });
      await assert.rejects(() => deletePhase(first.id), hasSpec(projectErrors.phaseNotFound));
      await assert.rejects(() => prisma.$transaction(tx => createPhase(tx, "missing", { name: "No" })), hasSpec(projectErrors.phaseParentNotFound));
      await prisma.$transaction(tx => updateProject(tx, project.id, { status: "COMPLETED" }));
      await assert.rejects(() => prisma.$transaction(tx => createPhase(tx, project.id, { name: "No" })), hasSpec(projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork));
      await reset();
    });

    await context.test("placement preserves all relationship errors and completed-project exception", async () => {
      const project = await create();
      const other = await create("Other");
      const completed = await prisma.project.create({ data: { name: "Done", status: "COMPLETED" } });
      const phase = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Phase" }));
      for (const [projectId, phaseId, spec] of [
        [null, phase.id, projectErrors.aTaskCannotHaveAPhaseWithoutAProject],
        ["missing", null, projectErrors.theSelectedProjectCouldNotBeFound],
        [completed.id, null, projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork],
        [project.id, "missing", projectErrors.theSelectedPhaseCouldNotBeFound],
        [other.id, phase.id, projectErrors.theSelectedPhaseDoesNotBelongToThisProject]
      ] as const) {
        await assert.rejects(() => prisma.$transaction(tx => validateProjectPlacement(tx, projectId, phaseId)), hasSpec(spec));
      }
      await prisma.$transaction(async tx => {
        await validateProjectPlacement(tx, null, null);
        await validateProjectPlacement(tx, project.id, phase.id);
        await validateProjectPlacement(tx, completed.id, null, { allowCompleted: true });
      });
      await reset();
    });

    await context.test("summary and detail retain legacy values, ordering, journal deduplication and attribution", async (contract) => {
      const at = (offset: number) => new Date(period.start.getTime() + offset * 1000);
      const project = await create("Read model");
      const otherCreated = await create("Other");
      const other = await prisma.project.update({ where: { id: otherCreated.id }, data: { updatedAt: new Date(project.updatedAt.getTime() + 1000) } });
      const emptyCreated = await create("Empty");
      const empty = await prisma.project.update({ where: { id: emptyCreated.id }, data: { updatedAt: new Date(project.updatedAt.getTime() + 2000) } });
      const tasksOnlyCreated = await create("Tasks only");
      const tasksOnly = await prisma.project.update({ where: { id: tasksOnlyCreated.id }, data: { status: "PAUSED" } });
      const later = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Later" }));
      const earlier = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Earlier" }));
      const firstPhase = await prisma.$transaction(tx => updatePhase(tx, earlier.id, { sortOrder: 0 }));
      // Query order interleaves projects; tied scheduled dates must keep source order.
      const backlog = await prisma.task.create({ data: { title: "Backlog", projectId: project.id, sortOrder: 1 } });
      const otherBacklog = await prisma.task.create({ data: { title: "Other backlog", projectId: other.id, sortOrder: 2 } });
      const dated = await prisma.task.create({ data: { title: "Next", projectId: project.id, date: period.start, sortOrder: 2, estimateMinutes: 42 } });
      const otherDated = await prisma.task.create({ data: { title: "Other next", projectId: other.id, date: period.start, sortOrder: 3, estimateMinutes: 12 } });
      const datedSecond = await prisma.task.create({ data: { title: "Same date, later order", projectId: project.id, date: period.start, sortOrder: 4 } });
      const done = await prisma.task.create({ data: { title: "Done", projectId: project.id, status: "DONE", completedAt: period.start, sortOrder: 3 } });
      const loneTask = await prisma.task.create({ data: { title: "No evidence", projectId: tasksOnly.id, sortOrder: 4, estimateMinutes: 7 } });
      // Source chronology crosses direct and task buckets. Done and datedSecond have empty journal buckets.
      const note = (content: string, offset: number, links: { projectId?: string; taskId?: string }, tags = "[]") =>
        prisma.note.create({ data: { content, tags, date: period.start, createdAt: at(offset), ...links } });
      const direct = await note("Dual linked", 2, { projectId: project.id, taskId: dated.id }, '["tag", "second"]');
      const taskNote = await note("Backlog older", 3, { taskId: backlog.id }, "invalid");
      const datedNote = await note("Dated newest", 8, { taskId: dated.id }, '{"not":"array"}');
      const directOnly = await note("Direct only", 5, { projectId: project.id }, '["direct"]');
      const taskNoteNewer = await note("Backlog newer", 7, { taskId: backlog.id }, "null");
      const datedNoteOlder = await note("Dated oldest", 1, { taskId: dated.id });
      await note("Unrelated", 9, { projectId: other.id, taskId: otherBacklog.id });
      const material = (title: string, offset: number, links: { projectId?: string; taskId?: string }) =>
        prisma.material.create({ data: { title, url: "https://example.com", createdAt: at(offset), ...links } });
      const dualMaterial = await material("Dual linked", 2, { projectId: project.id, taskId: dated.id });
      const taskMaterial = await material("Backlog older", 3, { taskId: backlog.id });
      const datedMaterial = await material("Dated newest", 8, { taskId: dated.id });
      const directMaterial = await material("Direct only", 5, { projectId: project.id });
      const taskMaterialNewer = await material("Backlog newer", 7, { taskId: backlog.id });
      const datedMaterialOlder = await material("Dated oldest", 1, { taskId: dated.id });
      await material("Unrelated", 9, { projectId: other.id, taskId: otherBacklog.id });
      const activity = await prisma.activityEntry.create({ data: { startedAt: period.start, durationMinutes: 20, category: "Work", note: "", attributedProjectId: project.id } });
      await prisma.activityEntry.create({ data: { startedAt: at(1), durationMinutes: 7, category: "Work", note: "", projectId: project.id, attributedProjectId: other.id } });
      const future = await prisma.activityEntry.create({ data: { startedAt: period.end, durationMinutes: 10, category: "Work", note: "", attributedProjectId: project.id } });
      await prisma.activityEntry.create({ data: { startedAt: at(-1), durationMinutes: 13, category: "Work", note: "", attributedProjectId: other.id } });
      // Direct or task links alone do not contribute to project invested minutes.
      await prisma.activityEntry.create({ data: { startedAt: period.start, durationMinutes: 99, category: "Other", note: "", projectId: project.id, taskId: backlog.id } });
      const expected = { ...project, completedTaskCount: 1, taskCount: 4, progressPercent: 25,
        phaseCount: 2, backlogCount: 1, investedMinutes: 30, reviewPeriodInvestedMinutes: 20,
        movedDuringReviewPeriod: true, nextTaskId: dated.id, nextTaskTitle: "Next", nextTaskEstimateMinutes: 42, lastProgressAt: period.end };
      const emptySummary = { ...empty, completedTaskCount: 0, taskCount: 0, progressPercent: null,
        phaseCount: 0, backlogCount: 0, investedMinutes: 0, reviewPeriodInvestedMinutes: 0, movedDuringReviewPeriod: false,
        nextTaskId: null, nextTaskTitle: null, nextTaskEstimateMinutes: null, lastProgressAt: null };
      const otherSummary = { ...other, completedTaskCount: 0, taskCount: 2, progressPercent: 0,
        phaseCount: 0, backlogCount: 1, investedMinutes: 20, reviewPeriodInvestedMinutes: 7, movedDuringReviewPeriod: true,
        nextTaskId: otherDated.id, nextTaskTitle: "Other next", nextTaskEstimateMinutes: 12, lastProgressAt: at(1) };
      const tasksOnlySummary = { ...tasksOnly, completedTaskCount: 0, taskCount: 1, progressPercent: 0,
        phaseCount: 0, backlogCount: 1, investedMinutes: 0, reviewPeriodInvestedMinutes: 0, movedDuringReviewPeriod: false,
        nextTaskId: loneTask.id, nextTaskTitle: "No evidence", nextTaskEstimateMinutes: 7, lastProgressAt: null };
      await prisma.$transaction(async tx => {
        const detail = await getProjectDetail(tx, project.id, period);
        assert.deepEqual(detail, { ...expected, phases: [firstPhase, later], tasks: [backlog, done, dated, datedSecond],
          activities: [future, activity],
          notes: [{ ...directOnly, tags: ["direct"] }, { ...direct, tags: ["tag", "second"] },
            { ...taskNoteNewer, tags: [] }, { ...taskNote, tags: [] }, { ...datedNote, tags: [] }, { ...datedNoteOlder, tags: [] }],
          materials: [directMaterial, dualMaterial, taskMaterialNewer, taskMaterial, datedMaterial, datedMaterialOlder] });
        assert.ok(isProjectDetailResponse(json(detail)));
        assert.deepEqual(await listProjectSummaries(tx, period), [emptySummary, otherSummary, expected, tasksOnlySummary]);
        assert.deepEqual(await getProjectDetail(tx, empty.id, period), { ...emptySummary, phases: [], tasks: [], activities: [], notes: [], materials: [] });
        assert.equal(await getProjectDetail(tx, "missing", period), null);
      });
      await contract.test("summary grouping reads each returned row key a bounded number of times", async () => {
        await prisma.$transaction(async tx => {
          const counted = countRowKeys(tx, { task: "projectId", activityEntry: "attributedProjectId" });
          await listProjectSummaries(counted.database, period);
          assert.deepEqual(counted.rows, { task: 7, activityEntry: 4 });
          contract.diagnostic(`summary key reads: ${JSON.stringify(counted.reads)}`);
          for (const [key, rowCount] of Object.entries(counted.rows)) {
            assert.ok(counted.reads[key] <= 2 * rowCount, `${key}: ${counted.reads[key]} key reads for ${rowCount} rows`);
          }
        });
      });
      await contract.test("journal grouping reads each returned task key a bounded number of times", async () => {
        await prisma.$transaction(async tx => {
          const counted = countRowKeys(tx, { note: "taskId", material: "taskId" });
          await getProjectDetail(counted.database, project.id, period);
          assert.deepEqual(counted.rows, { note: 6, material: 6 });
          contract.diagnostic(`journal task key reads: ${JSON.stringify(counted.reads)}`);
          for (const [key, rowCount] of Object.entries(counted.rows)) {
            // Notes also read taskId when spreading the final row for tag parsing.
            assert.ok(counted.reads[key] <= 3 * rowCount, `${key}: ${counted.reads[key]} key reads for ${rowCount} rows`);
          }
        });
      });
      await reset();
      await contract.test("empty project summaries skip task and activity reads", async () => {
        await prisma.$transaction(async tx => {
          const counted = countRowKeys(tx, { task: "projectId", activityEntry: "attributedProjectId" });
          assert.deepEqual(await listProjectSummaries(counted.database, period), []);
          assert.deepEqual(counted.rows, {});
        });
      });
    });

    await context.test("SQLite P2025 update races translate locally and roll back disappearing records", async () => {
      const project = await create();
      const phase = await prisma.$transaction(tx => createPhase(tx, project.id, { name: "Phase" }));
      for (const [table, operation, spec] of [
        ["Project", () => prisma.$transaction(tx => updateProject(tx, project.id, { name: "Lost" })), projectErrors.projectNotFound],
        ["ProjectPhase", () => prisma.$transaction(tx => updatePhase(tx, phase.id, { name: "Lost" })), projectErrors.phaseNotFound]
      ] as const) {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER disappear_before_update BEFORE UPDATE ON "${table}"
          BEGIN DELETE FROM "${table}" WHERE id = OLD.id; END;`);
        try { await assert.rejects(operation, hasSpec(spec)); }
        finally { await prisma.$executeRawUnsafe("DROP TRIGGER disappear_before_update"); }
      }
      assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: project.id } }), project);
      assert.deepEqual(await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } }), phase);
      // The parent disappears after the phase service's validation read.
      await prisma.$executeRawUnsafe(`CREATE TRIGGER disappear_phase_parent BEFORE INSERT ON "ProjectPhase"
        BEGIN DELETE FROM "Project" WHERE id = NEW.projectId; END;`);
      try {
        await assert.rejects(() => prisma.$transaction(tx => createPhase(tx, project.id, { name: "Lost" })), hasSpec(projectErrors.theSelectedProjectIsNoLongerAvailable));
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER disappear_phase_parent"); }
      assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: project.id } }), project);
      await reset();
    });
  });
});

test("project persistence translations preserve operation-specific contracts and unknown errors", () => {
  for (const [action, code, spec] of [
    ["create", "P2003", projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeCreated],
    ["save", "P2003", projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeSaved],
    ["delete", "P2003", projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeSaved],
    ["save", "P2025", projectErrors.projectNotFound],
    ["delete", "P2025", projectErrors.projectNotFound],
    ["phase-create", "P2003", projectErrors.theSelectedProjectIsNoLongerAvailable],
    ["phase-save", "P2025", projectErrors.phaseNotFound],
    ["phase-delete", "P2025", projectErrors.phaseNotFound]
  ] as const) {
    hasSpec(spec)(translateProjectPersistenceError(new Prisma.PrismaClientKnownRequestError("race", { code, clientVersion: "test" }), action));
  }
  for (const action of ["create", "save", "delete", "phase-create", "phase-save", "phase-delete"] as const) {
    for (const error of [new Error("unknown"), { code: "P2003" }, new Prisma.PrismaClientKnownRequestError("receipt", { code: "P2002", clientVersion: "test" })]) {
      assert.equal(translateProjectPersistenceError(error, action), error);
    }
  }
});
