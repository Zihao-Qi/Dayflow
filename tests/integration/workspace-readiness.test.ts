import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

test("bootstrap reports authoritative workspace readiness", async (context) => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dayflow-workspace-readiness-test-")
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

  const [{ GET: loadBootstrap }, { prisma }] = await Promise.all([
    import("../../src/app/api/bootstrap/route"),
    import("../../src/lib/prisma")
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  async function workspaceEmpty() {
    const response = await loadBootstrap();
    assert.equal(response.status, 200);
    const body = (await response.json()) as { workspaceEmpty?: unknown };
    return body.workspaceEmpty;
  }

  assert.equal(await workspaceEmpty(), true);

  await prisma.mutationReceipt.create({
    data: {
      id: "internal-receipt",
      kind: "test",
      requestHash: "hash",
      responseJson: "{}"
    }
  });
  assert.equal(
    await workspaceEmpty(),
    true,
    "internal mutation bookkeeping must not establish a workspace"
  );
  await prisma.mutationReceipt.deleteMany();

  const date = new Date("2026-01-02T12:00:00.000Z");
  const meaningfulRecords = [
    {
      label: "Project",
      create: () => prisma.project.create({ data: { name: "Existing Project" } }),
      clear: () => prisma.project.deleteMany()
    },
    {
      label: "Task",
      create: () => prisma.task.create({ data: { title: "Existing Task" } }),
      clear: () => prisma.task.deleteMany()
    },
    {
      label: "Note",
      create: () =>
        prisma.note.create({
          data: { content: "Existing Note", date }
        }),
      clear: () => prisma.note.deleteMany()
    },
    {
      label: "Diary Entry",
      create: () => prisma.diaryEntry.create({ data: { date } }),
      clear: () => prisma.diaryEntry.deleteMany()
    },
    {
      label: "Review",
      create: () =>
        prisma.review.create({
          data: {
            periodStart: date,
            periodEnd: new Date("2026-01-09T12:00:00.000Z")
          }
        }),
      clear: () => prisma.review.deleteMany()
    },
    {
      label: "Reference",
      create: () =>
        prisma.material.create({
          data: {
            title: "Existing Reference",
            url: "https://example.com/existing"
          }
        }),
      clear: () => prisma.material.deleteMany()
    },
    {
      label: "Time Block",
      create: () =>
        prisma.timeBlock.create({
          data: {
            date,
            startTime: "09:00",
            endTime: "10:00",
            title: "Existing Time Block"
          }
        }),
      clear: () => prisma.timeBlock.deleteMany()
    },
    {
      label: "Activity",
      create: () =>
        prisma.activityEntry.create({
          data: {
            startedAt: date,
            durationMinutes: 30,
            category: "Work",
            note: "Existing Activity"
          }
        }),
      clear: () => prisma.activityEntry.deleteMany()
    },
    {
      label: "Focus Session",
      create: () =>
        prisma.focusSession.create({
          data: {
            kind: "BREAK",
            plannedMinutes: 5,
            status: "CANCELED"
          }
        }),
      clear: () => prisma.focusSession.deleteMany()
    }
  ] as const;

  for (const record of meaningfulRecords) {
    await record.create();
    assert.equal(
      await workspaceEmpty(),
      false,
      `${record.label} must establish the workspace outside bootstrap windows`
    );
    await record.clear();
    assert.equal(await workspaceEmpty(), true);
  }
});
