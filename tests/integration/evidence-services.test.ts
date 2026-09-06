import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { parseActivityCreateMutation, parseActivityReplaceMutation, evidenceErrors } from "../../src/modules/evidence/domain/activity";
import { parseDiaryUpsertMutation } from "../../src/modules/evidence/domain/diary";
import { createActivity, replaceActivity, deleteActivity, readDayActivities, readActivityCategories, readReviewActivities, readEarliestActivity, readProjectActivities, readProjectActivitySummaries } from "../../src/modules/evidence/services/activities";
import { upsertDiary, readDiary, readReviewDiaries } from "../../src/modules/evidence/services/diary";
import { recordFocusActivity } from "../../src/modules/evidence/services/focus-activity";
import { AppError } from "../../src/shared/kernel/errors";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-evidence-services-test-"));
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
  const [{ prisma }, { runOnce }] = await Promise.all([
    import("../../src/lib/prisma"),
    import("../../src/server/prisma/run-once")
  ]);
  disconnect = () => prisma.$disconnect();
  await run({ prisma, runOnce });
}

const now = new Date("2026-09-04T12:00:00-05:00");
const body = { date: "2026-09-03", startTime: "09:00", durationMinutes: 25, category: "Admin", note: "Original", taskId: null, projectId: null };
const createInput = (changes: Record<string, unknown> = {}) => parseActivityCreateMutation({ ...body, ...changes }, now);
const replaceInput = (changes: Record<string, unknown> = {}) => parseActivityReplaceMutation({ ...body, ...changes });
const hasSpec = (spec: AppError["spec"]) => (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.deepEqual(error.spec, spec);
  return true;
};

test("evidence services run headlessly on SQLite", async context => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const project = await prisma.project.create({ data: { name: "Original project" } });
    const other = await prisma.project.create({ data: { name: "New project" } });
    const task = await prisma.task.create({ data: { title: "Task title", projectId: project.id } });
    const create = (changes: Record<string, unknown> = {}) => prisma.$transaction(tx => createActivity(tx, createInput(changes)));

    await context.test("create attributes through a Task or directly to a Project and ignores forged origin", async () => {
      const session = await prisma.focusSession.create({ data: { kind: "FOCUS", plannedMinutes: 25, startedAt: now } });
      // Add forged fields after parsing so they reach the service. A real session
      // makes accidental persistence fail these assertions, not a foreign-key check.
      const forgedInput = { ...createInput({ taskId: task.id, projectId: project.id }), origin: "FOCUS", focusSessionId: session.id };
      const linked = await prisma.$transaction(tx => createActivity(tx, forgedInput));
      assert.equal(linked.taskId, task.id);
      assert.equal(linked.projectId, null);
      assert.equal(linked.attributedProjectId, project.id);
      assert.equal(linked.origin, "MANUAL");
      assert.equal(linked.focusSessionId, null);
      const direct = await create({ projectId: other.id });
      assert.equal(direct.taskId, null);
      assert.equal(direct.projectId, other.id);
      assert.equal(direct.attributedProjectId, other.id);
      await assert.rejects(() => create({ taskId: task.id, projectId: other.id }), hasSpec(evidenceErrors.theSelectedTaskBelongsToADifferentProject));
      await assert.rejects(() => create({ taskId: "missing" }), hasSpec(evidenceErrors.theLinkedTaskCouldNotBeFound));
      await assert.rejects(() => create({ projectId: "missing" }), hasSpec(evidenceErrors.theLinkedProjectCouldNotBeFound));
    });

    await context.test("parser rejects a future date before the Activity service runs", async () => {
      const count = await prisma.activityEntry.count();
      await assert.rejects(async () => create({ date: "2026-09-05" }), hasSpec(evidenceErrors.activityDateCannotBeInTheFuture));
      assert.equal(await prisma.activityEntry.count(), count);
    });

    await context.test("unchanged relationships preserve historical attribution; changed relationships resolve again", async () => {
      const activity = await create({ taskId: task.id });
      await prisma.task.update({ where: { id: task.id }, data: { projectId: other.id } });
      const updated = await prisma.$transaction(tx => replaceActivity(tx, activity.id, replaceInput({ taskId: task.id, note: "Edited", startTime: "10:15" })));
      assert.equal(updated.attributedProjectId, project.id);
      assert.equal(updated.startedAt.getDate(), activity.startedAt.getDate());
      assert.equal(updated.startedAt.getHours(), 10);
      assert.equal(updated.startedAt.getMinutes(), 15);
      const changed = await prisma.$transaction(tx => replaceActivity(tx, activity.id, replaceInput({ projectId: other.id })));
      assert.equal(changed.taskId, null);
      assert.equal(changed.projectId, other.id);
      assert.equal(changed.attributedProjectId, other.id);
      await prisma.task.update({ where: { id: task.id }, data: { projectId: project.id } });
    });

    await context.test("stale updatedAt rejects replacement and rolls back a competing write", async () => {
      const activity = await create();
      await assert.rejects(() => prisma.$transaction(async tx => {
        let first = true;
        const instrumented = { ...tx, activityEntry: { ...tx.activityEntry,
          findUnique: async (args: Parameters<typeof tx.activityEntry.findUnique>[0]) => {
            const row = await tx.activityEntry.findUnique(args);
            if (first) {
              first = false;
              await tx.activityEntry.update({ where: { id: activity.id }, data: { note: "Competing", updatedAt: new Date(activity.updatedAt.getTime() + 1000) } });
            }
            return row;
          }
        } } as unknown as Prisma.TransactionClient;
        return replaceActivity(instrumented, activity.id, replaceInput({ note: "Replacement" }));
      }), hasSpec(evidenceErrors.theActivityChangedBeforeItCouldBeUpdated));
      assert.deepEqual(await prisma.activityEntry.findUniqueOrThrow({ where: { id: activity.id } }), activity);
    });

    await context.test("delete removes manual evidence and preserves missing envelopes", async () => {
      const activity = await create();
      assert.deepEqual(await prisma.$transaction(tx => deleteActivity(tx, activity.id)), { ok: true, id: activity.id });
      assert.equal(await prisma.activityEntry.findUnique({ where: { id: activity.id } }), null);
      await assert.rejects(() => prisma.$transaction(tx => deleteActivity(tx, activity.id)), hasSpec(evidenceErrors.activityDeleteNotFound));
      await assert.rejects(() => prisma.$transaction(tx => replaceActivity(tx, activity.id, replaceInput())), hasSpec(evidenceErrors.activityNotFound));
    });

    await context.test("replace and delete protect either focus origin or a focus session link", async () => {
      for (const origin of ["FOCUS", "MANUAL"] as const) {
        const session = await prisma.focusSession.create({ data: { kind: "FOCUS", plannedMinutes: 25, startedAt: now } });
        const activity = await prisma.activityEntry.create({ data: { ...createInput(), origin, focusSessionId: origin === "MANUAL" ? session.id : null } });
        await assert.rejects(() => prisma.$transaction(tx => replaceActivity(tx, activity.id, replaceInput())), hasSpec(evidenceErrors.focusEvidenceCannotBeEditedHere));
        await assert.rejects(() => prisma.$transaction(tx => deleteActivity(tx, activity.id)), hasSpec(evidenceErrors.focusEvidenceCannotBeDeleted));
        assert.deepEqual(await prisma.activityEntry.findUniqueOrThrow({ where: { id: activity.id } }), activity);
      }
    });

    await context.test("Diary upsert retains one row per date and exact writing", async () => {
      const input = parseDiaryUpsertMutation({ date: "2026-09-03", content: "  Writing.\n" }, now);
      const first = await prisma.$transaction(tx => upsertDiary(tx, input));
      const second = await prisma.$transaction(tx => upsertDiary(tx, { ...input, reflection: "Reflection ", mood: 5, energy: 1 }));
      assert.equal(second.id, first.id);
      assert.equal(second.content, "  Writing.\n");
      assert.equal(second.reflection, "Reflection ");
      assert.equal(second.mood, 5);
      assert.equal(second.energy, 1);
      assert.equal(await prisma.diaryEntry.count(), 1);
    });

    await context.test("receipt replay and receipt failure preserve Activity atomicity", async () => {
      const options = { mutationId: "evidence-replay", kind: "activity.create", payload: body,
        create: (tx: Prisma.TransactionClient) => createActivity(tx, createInput()) };
      const first = await runOnce(options);
      assert.deepEqual(await runOnce(options), JSON.parse(JSON.stringify(first)));
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_evidence_receipt BEFORE INSERT ON "MutationReceipt" BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
      const count = await prisma.activityEntry.count();
      try { await assert.rejects(() => runOnce({ ...options, mutationId: "evidence-fail" })); }
      finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_evidence_receipt'); }
      assert.equal(await prisma.activityEntry.count(), count);
    });

    await context.test("bootstrap, day, review and project reads preserve the legacy rows and order", async () => {
      const range = { start: new Date("2026-09-03T00:00:00-05:00"), end: new Date("2026-09-04T00:00:00-05:00") };
      // Deliberately include tied start times and both outside boundaries.
      await create({ startTime: "09:00", category: "Learning" });
      await create({ startTime: "00:00" });
      await create({ date: "2026-09-02", startTime: "23:59" });
      await create({ date: "2026-09-04", startTime: "00:00" });
      await prisma.$transaction(async tx => {
        assert.deepEqual(await readDayActivities(tx, range), await tx.activityEntry.findMany({ where: { startedAt: { gte: range.start, lt: range.end } }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }] }));
        assert.deepEqual(await readActivityCategories(tx), await tx.activityEntry.findMany({ select: { category: true }, distinct: ["category"] }));
        assert.deepEqual(await readReviewActivities(tx, range), await tx.activityEntry.findMany({ where: { startedAt: { gte: range.start, lt: range.end } }, orderBy: { startedAt: "asc" }, include: { focusSession: { select: { needsEnrichment: true } } } }));
        assert.deepEqual(await readEarliestActivity(tx), await tx.activityEntry.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } }));
        assert.deepEqual(await readProjectActivities(tx, project.id), await tx.activityEntry.findMany({ where: { attributedProjectId: project.id }, orderBy: { startedAt: "desc" } }));
        assert.deepEqual(await readProjectActivitySummaries(tx, [project.id, other.id]), await tx.activityEntry.findMany({ where: { attributedProjectId: { in: [project.id, other.id] } }, select: { id: true, attributedProjectId: true, durationMinutes: true, startedAt: true } }));
        assert.deepEqual(await readDiary(tx, range.start), await tx.diaryEntry.findUnique({ where: { date: range.start } }));
        assert.deepEqual(await readReviewDiaries(tx, range), await tx.diaryEntry.findMany({ where: { date: { gte: range.start, lt: range.end } }, orderBy: { date: "asc" } }));
      });
    });

    await context.test("Focus completion and enrichment persist independently specified rows", async () => {
      // Freeze database-generated metadata so every persisted field can be asserted.
      const stable = (tx: Prisma.TransactionClient) => ({ ...tx, activityEntry: { ...tx.activityEntry,
        upsert: (args: Prisma.ActivityEntryUpsertArgs) => tx.activityEntry.upsert({ ...args,
          create: { ...args.create, id: "focus-parity", createdAt: now, updatedAt: now },
          update: Object.keys(args.update).length ? { ...args.update, updatedAt: now } : args.update
        })
      } }) as unknown as Prisma.TransactionClient;
      for (const taskId of [task.id, null]) {
        for (const enrich of [false, true]) {
          for (const existing of [false, true]) {
            const session = await prisma.focusSession.create({ data: {
              kind: "FOCUS", plannedMinutes: 25, actualMinutes: 3,
              startedAt: new Date(now.getTime() - 3 * 60_000), taskId, projectId: other.id,
              label: "Session label", status: "COMPLETED", activeKey: null
            }, include: { task: true } });
            const seed = async () => {
              if (existing) await prisma.activityEntry.create({ data: { id: "focus-parity", createdAt: now, updatedAt: now,
                startedAt: new Date("2026-08-01T09:00:00-05:00"), durationMinutes: 17, category: "Health", note: "Historical",
                origin: "FOCUS", focusSessionId: session.id, attributedProjectId: other.id } });
            };
            await seed();
            // Specify the contract directly: completion preserves existing evidence;
            // enrichment changes only its category/note. New rows use session values
            // and prefer the Task's Project over the session's direct Project.
            const expected = {
              id: "focus-parity",
              startedAt: new Date(existing ? "2026-08-01T09:00:00-05:00" : "2026-09-04T11:57:00-05:00"),
              durationMinutes: existing ? 17 : 3,
              category: enrich ? "Learning" : existing ? "Health" : "Deep Work",
              note: enrich ? "Enriched note" : existing ? "Historical" : taskId ? "Task title" : "Session label",
              origin: "FOCUS",
              taskId: existing ? null : taskId,
              projectId: existing || taskId ? null : other.id,
              attributedProjectId: existing || !taskId ? other.id : project.id,
              focusSessionId: session.id,
              createdAt: now,
              updatedAt: now
            };
            const actual = await prisma.$transaction(tx => recordFocusActivity(stable(tx), session,
              enrich ? { category: "Learning", note: "Enriched note" } : undefined));
            const scenario = `task=${Boolean(taskId)}, enrich=${enrich}, existing=${existing}`;
            assert.deepEqual(actual, expected, scenario);
            assert.deepEqual(await prisma.activityEntry.findUniqueOrThrow({
              where: { focusSessionId: session.id }
            }), expected, `persisted ${scenario}`);
            await prisma.activityEntry.delete({ where: { id: actual.id } });
          }
        }
      }
    });
  });
});
