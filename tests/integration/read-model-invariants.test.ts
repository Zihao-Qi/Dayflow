import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { addDays, startOfLocalDay } from "../../src/lib/dates";

const repositoryRoot = process.cwd();
const prismaCliPath = join(
  repositoryRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

test("bootstrap and agent export preserve their payload contracts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-read-model-test-"));
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

  const [{ GET: loadBootstrap }, { GET: loadAgentExport }, { prisma }] =
    await Promise.all([
      import("../../src/app/api/bootstrap/route"),
      import("../../src/app/api/agent-export/route"),
      import("../../src/lib/prisma")
    ]);
  disconnectPrisma = () => prisma.$disconnect();

  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T12:00:00-05:00") });
  const today = startOfLocalDay();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const overdue = await prisma.task.create({
    data: { title: "Keep the original date", date: yesterday, status: "TODO" }
  });
  const note = await prisma.note.create({
    data: {
      content: "Decode tags",
      tags: JSON.stringify(["architecture", "phase-0"]),
      date: today
    }
  });
  const scalarTagsNote = await prisma.note.create({
    data: {
      content: "Normalize non-array tags",
      tags: JSON.stringify("architecture"),
      date: today
    }
  });
  const currentActivity = await prisma.activityEntry.create({
    data: {
      startedAt: new Date(today.getTime() + 9 * 60 * 60 * 1000),
      durationMinutes: 20,
      category: "Deep Work",
      note: "Current evidence"
    }
  });
  const futureActivity = await prisma.activityEntry.create({
    data: {
      startedAt: new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000),
      durationMinutes: 20,
      category: "Deep Work",
      note: "Future planted evidence"
    }
  });

  await context.test(
    "bootstrap has the exact top-level keys and filters future Activity without moving Tasks",
    async () => {
      const response = await loadBootstrap();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), [
        "activities",
        "activityCategorySuggestions",
        "dayViewForwardWeeks",
        "diary",
        "earliestDayKey",
        "materials",
        "notes",
        "paletteTasks",
        "projects",
        "review",
        "reviewSummary",
        "stats",
        "tasks",
        "timeBlocks",
        "today",
        "todayKey",
        "unfinishedTasks",
        "workspaceEmpty"
      ]);
      assert.deepEqual(
        body.activities.map((activity: { id: string }) => activity.id),
        [currentActivity.id]
      );
      assert.equal(
        body.activities.some(
          (activity: { startedAt: string }) =>
            new Date(activity.startedAt).getTime() > Date.now()
        ),
        false
      );
      const returnedTask = body.tasks.find(
        (task: { id: string }) => task.id === overdue.id
      );
      assert.equal(new Date(returnedTask.date).getTime(), yesterday.getTime());
      assert.deepEqual(
        body.notes.find((candidate: { id: string }) => candidate.id === note.id)
          .tags,
        ["architecture", "phase-0"]
      );
      assert.deepEqual(
        body.notes.find((candidate: { id: string }) => candidate.id === scalarTagsNote.id)
          .tags,
        [],
        "bootstrap must normalize valid JSON scalar tags to an array"
      );
    }
  );

  await context.test(
    "agent export has the exact top-level keys and decodes tags without moving Tasks",
    async () => {
      const response = await loadAgentExport();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), [
        "activities",
        "app",
        "diaryEntries",
        "exportFormat",
        "exportVersion",
        "exportedAt",
        "focusSessions",
        "materials",
        "notes",
        "phases",
        "projects",
        "purpose",
        "reviews",
        "scheduleChanges",
        "schemaVersion",
        "tasks",
        "timeBlocks"
      ]);
      assert.equal(
        new Date(
          body.tasks.find((task: { id: string }) => task.id === overdue.id).date
        ).getTime(),
        yesterday.getTime()
      );
      assert.deepEqual(
        body.notes.find((candidate: { id: string }) => candidate.id === note.id)
          .tags,
        ["architecture", "phase-0"]
      );
      assert.deepEqual(
        body.notes.find((candidate: { id: string }) => candidate.id === scalarTagsNote.id)
          .tags,
        [],
        "agent export must normalize valid JSON scalar tags to an array"
      );
      assert.equal(
        body.activities.some(
          (activity: { id: string }) => activity.id === futureActivity.id
        ),
        true,
        "the complete agent export currently includes directly planted future evidence"
      );
    }
  );
});
