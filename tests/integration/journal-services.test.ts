import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseNoteCreateInput, parseMaterialCreateInput, journalErrors } from "../../src/modules/journal/domain/journal";
import { createNote, readNoteHistory, detachProjectNotes, readDayNotes, readProjectNotes, readReviewNotes } from "../../src/modules/journal/services/notes";
import { createMaterial, readMaterialHistory, detachProjectMaterials, readRecentMaterials, readProjectMaterials, readReviewMaterials } from "../../src/modules/journal/services/materials";
import { parseJournalHistoryCriteria } from "../../src/modules/journal/services/history";
import { AppError } from "../../src/shared/kernel/errors";

async function withDatabase(
  context: { after: (fn: () => unknown) => void },
  run: (deps: {
    prisma: import("@prisma/client").PrismaClient;
    runOnce: typeof import("../../src/server/prisma/run-once").runOnce;
  }) => Promise<void>
) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-journal-services-test-"));
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

const now = new Date("2026-09-04T12:00:00-05:00");
const noteInput = (changes: Record<string, unknown> = {}) => parseNoteCreateInput({ content: "Decision", date: "2026-09-03", ...changes }, now);
const materialInput = (changes: Record<string, unknown> = {}) => parseMaterialCreateInput({ url: "https://example.com", ...changes });
const hasSpec = (spec: AppError["spec"]) => (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.deepEqual(error.spec, spec);
  return true;
};

test("journal services run headlessly on SQLite", async context => {
  await withDatabase(context, async ({ prisma, runOnce }) => {
    const project = await prisma.project.create({ data: { name: "Journal project" } });
    const other = await prisma.project.create({ data: { name: "Other project" } });
    const task = await prisma.task.create({ data: { title: "Task", projectId: project.id } });
    const standalone = await prisma.task.create({ data: { title: "Standalone" } });
    const note = (changes: Record<string, unknown> = {}) => prisma.$transaction(tx => createNote(tx, noteInput(changes)));
    const material = (changes: Record<string, unknown> = {}) => prisma.$transaction(tx => createMaterial(tx, materialInput(changes)));
    const notes = (params: Record<string, string> = {}) => prisma.$transaction(tx => readNoteHistory(tx, parseJournalHistoryCriteria(new URLSearchParams(params), "note")));
    const materials = (params: Record<string, string> = {}) => prisma.$transaction(tx => readMaterialHistory(tx, parseJournalHistoryCriteria(new URLSearchParams(params), "material")));

    await context.test("create preserves task attribution and separate note provenance", async () => {
      const linked = await note({ taskId: task.id, projectId: project.id, tags: ["#Design Systems", "DESIGN SYSTEMS"] });
      assert.equal(linked.taskId, task.id);
      assert.equal(linked.projectId, null);
      assert.equal(linked.tags, '["design-systems"]');
      const direct = await note({ taskId: standalone.id, projectId: other.id });
      assert.equal(direct.projectId, other.id);
      const reference = await material({ taskId: task.id, noteId: linked.id, projectId: project.id });
      assert.equal(reference.taskId, task.id);
      assert.equal(reference.noteId, linked.id);
      assert.equal(reference.projectId, null);
      const provenance = await material({ noteId: linked.id });
      assert.equal(provenance.noteId, linked.id);
      assert.equal(provenance.taskId, null);
      assert.equal(provenance.projectId, null);
    });

    await context.test("relation validation preserves precedence and rolls back failed creates", async () => {
      const linked = await note({ projectId: other.id });
      const before = [await prisma.note.count(), await prisma.material.count()];
      for (const create of [note, material]) {
        for (const [input, spec] of [
          [{ taskId: "missing", projectId: "missing" }, journalErrors.theLinkedTaskCouldNotBeFound],
          [{ projectId: "missing" }, journalErrors.theLinkedProjectCouldNotBeFound],
          [{ taskId: task.id, projectId: "missing" }, journalErrors.theLinkedProjectCouldNotBeFound],
          [{ taskId: task.id, projectId: other.id }, journalErrors.theSelectedTaskBelongsToADifferentProject]
        ] as const) await assert.rejects(() => create(input), hasSpec(spec));
      }
      await assert.rejects(() => material({ noteId: "missing" }), hasSpec(journalErrors.theLinkedNoteCouldNotBeFound));
      await assert.rejects(() => material({ taskId: task.id, noteId: linked.id }), hasSpec(journalErrors.theSelectedNoteBelongsToADifferentProject));
      assert.deepEqual([await prisma.note.count(), await prisma.material.count()], before);
    });

    await context.test("exact tags, literal search, invalid stored tags and all material search fields", async () => {
      const exact = await note({ content: "NEEDLE %_!", tags: ["Design"] });
      await note({ content: "NEEDLE wildcard", tags: ["design-systems"] });
      for (const tags of ['broken', '{}', '"design"']) await prisma.note.create({ data: { content: "NEEDLE", date: now, tags } });
      assert.deepEqual((await notes({ tag: "#DESIGN", q: "needle" })).items.map(row => row.id), [exact.id]);
      assert.deepEqual((await notes({ q: "%_!" })).items.map(row => row.id), [exact.id]);
      const expected = [];
      for (const changes of [{ title: "UniqueNeedle" }, { url: "https://example.com/UniqueNeedle" }, { notes: "UniqueNeedle" }]) expected.push((await material(changes)).id);
      const found = await materials({ q: "uniqueneedle" });
      assert.deepEqual(found.items.map(row => row.id).sort(), expected.sort());
      assert.equal(found.totalCount, 3);
      assert.ok((await notes({ q: "NEEDLE" })).items.every(row => Array.isArray(row.tags)));
    });

    await context.test("cursor tie breakers and totals remain stable across page boundaries and inserts", async () => {
      for (const kind of ["note", "material"] as const) {
        const query = kind === "note" ? notes : materials;
        for (const id of ["a", "c", "b"]) {
          const data = { id: `${kind}-${id}`, createdAt: now };
          if (kind === "note") await prisma.note.create({ data: { ...data, content: "cursor-marker", date: now } });
          else await prisma.material.create({ data: { ...data, title: "cursor-marker", url: "https://example.com" } });
        }
        const first = await query({ q: "cursor-marker", limit: "2" });
        assert.deepEqual(first.items.map(row => row.id), [`${kind}-c`, `${kind}-b`]);
        assert.equal(first.totalCount, 3);
        assert.ok(first.nextCursor);
        if (kind === "note") await prisma.note.create({ data: { content: "cursor-marker", date: now, createdAt: new Date(now.getTime() + 1000) } });
        else await prisma.material.create({ data: { title: "cursor-marker", url: "https://example.com", createdAt: new Date(now.getTime() + 1000) } });
        const second = await query({ q: "cursor-marker", limit: "2", cursor: first.nextCursor });
        assert.deepEqual(second.items.map(row => row.id), [`${kind}-a`]);
        assert.equal(second.totalCount, 4);
        assert.equal(second.nextCursor, null);
        await assert.rejects(() => query({ q: "different", cursor: first.nextCursor! }), hasSpec(journalErrors.thePaginationCursorIsInvalid));
      }
    });

    await context.test("page and total share a snapshot while another connection attempts an insert", async () => {
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
      const writer = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
      try {
        for (const kind of ["note", "material"] as const) {
          const marker = `snapshot-${kind}`;
          const insert = () => kind === "note"
            ? writer.note.create({ data: { content: marker, date: now } })
            : writer.material.create({ data: { title: marker, url: "https://example.com" } });
          await insert();
          let concurrentInsert: ReturnType<typeof insert> | undefined;
          const page = await prisma.$transaction(async tx => {
            let reads = 0;
            const instrumented = { ...tx, $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
              const rows = await tx.$queryRawUnsafe(sql, ...values);
              // Prisma SQLite reserves the writer lock for the read transaction.
              // Start the competing write between page/count; it commits after release.
              if (++reads === 1) concurrentInsert = insert();
              if (concurrentInsert) void Promise.resolve(concurrentInsert).catch(() => undefined);
              return rows;
            } } as unknown as Prisma.TransactionClient;
            const criteria = parseJournalHistoryCriteria(new URLSearchParams({ q: marker }), kind);
            return kind === "note" ? readNoteHistory(instrumented, criteria) : readMaterialHistory(instrumented, criteria);
          });
          assert.ok(concurrentInsert);
          await concurrentInsert;
          assert.equal(page.items.length, 1);
          assert.equal(page.totalCount, 1);
          const after = kind === "note" ? await notes({ q: marker }) : await materials({ q: marker });
          assert.equal(after.totalCount, 2);
        }
      } finally { await writer.$disconnect(); }
    });

    await context.test("receipt replay, mismatch and receipt failure preserve atomicity", async () => {
      for (const kind of ["note", "material"] as const) {
        const payload = kind === "note" ? { content: "Receipt note" } : { url: "https://example.com/receipt" };
        const options = { mutationId: `journal-${kind}`, kind: `${kind}.create`, payload,
          create: async (tx: Prisma.TransactionClient) => kind === "note" ? createNote(tx, noteInput(payload)) : createMaterial(tx, materialInput(payload)) };
        const first = await runOnce(options);
        const before = [await prisma.note.count(), await prisma.material.count()];
        assert.deepEqual(await runOnce(options), JSON.parse(JSON.stringify(first)));
        await assert.rejects(() => runOnce({ ...options, payload: { changed: true } }), (error: unknown) => error instanceof AppError && error.code === "MUTATION_ID_CONFLICT");
        await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_journal_receipt BEFORE INSERT ON "MutationReceipt" BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
        try { await assert.rejects(() => runOnce({ ...options, mutationId: `${kind}-rollback` })); }
        finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_journal_receipt'); }
        assert.deepEqual([await prisma.note.count(), await prisma.material.count()], before);
      }
    });

    await context.test("bootstrap, project and review reads preserve rows, ranges and ordering", async () => {
      const range = { start: new Date("2026-09-03T00:00:00-05:00"), end: new Date("2026-09-04T00:00:00-05:00") };
      await prisma.$transaction(async tx => {
        assert.deepEqual(await readDayNotes(tx, range), await tx.note.findMany({ where: { date: { gte: range.start, lt: range.end } }, orderBy: { createdAt: "desc" } }));
        assert.deepEqual(await readRecentMaterials(tx), await tx.material.findMany({ orderBy: { createdAt: "desc" }, take: 12 }));
        const where = { OR: [{ projectId: project.id }, { taskId: { in: [task.id] } }] };
        assert.deepEqual(await readProjectNotes(tx, project.id, [task.id]), await tx.note.findMany({ where, orderBy: { createdAt: "desc" } }));
        assert.deepEqual(await readProjectMaterials(tx, project.id, [task.id]), await tx.material.findMany({ where, orderBy: { createdAt: "desc" } }));
        assert.deepEqual(await readReviewNotes(tx, range), await tx.note.findMany({ where: { date: { gte: range.start, lt: range.end } }, select: { id: true } }));
        assert.deepEqual(await readReviewMaterials(tx, range), await tx.material.findMany({ where: { createdAt: { gte: range.start, lt: range.end } }, select: { id: true } }));
      });
    });

    await context.test("project detaches clear only direct project links and compose atomically", async () => {
      const linked = await note({ taskId: standalone.id, projectId: project.id });
      const reference = await material({ taskId: standalone.id, projectId: project.id, noteId: linked.id });
      const untouched = await note({ projectId: other.id });
      await assert.rejects(() => prisma.$transaction(async tx => {
        await detachProjectNotes(tx, project.id);
        await detachProjectMaterials(tx, project.id);
        throw new Error("rollback");
      }), /rollback/);
      assert.deepEqual(await prisma.note.findUniqueOrThrow({ where: { id: linked.id } }), linked);
      assert.deepEqual(await prisma.material.findUniqueOrThrow({ where: { id: reference.id } }), reference);
      await prisma.$transaction(async tx => {
        await detachProjectNotes(tx, project.id);
        await detachProjectMaterials(tx, project.id);
      });
      const detachedNote = await prisma.note.findUniqueOrThrow({ where: { id: linked.id } });
      const detachedMaterial = await prisma.material.findUniqueOrThrow({ where: { id: reference.id } });
      assert.ok(detachedNote.updatedAt >= linked.updatedAt);
      assert.ok(detachedMaterial.updatedAt >= reference.updatedAt);
      assert.deepEqual(detachedNote, { ...linked, projectId: null, updatedAt: detachedNote.updatedAt });
      assert.deepEqual(detachedMaterial, { ...reference, projectId: null, updatedAt: detachedMaterial.updatedAt });
      assert.deepEqual(await prisma.note.findUniqueOrThrow({ where: { id: untouched.id } }), untouched);
    });
  });
});
