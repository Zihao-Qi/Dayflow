import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PrismaClient } from "@prisma/client";
import { readBootstrap } from "../../src/server/read-models/bootstrap";
import { readTasksInDateRange } from "../../src/modules/planning/services/tasks";
import { resolveEarliestNavigableDayKey } from "../../src/lib/day-view";

const now = new Date(2026, 8, 4, 12);
const today = new Date(2026, 8, 4);
const day = (offset: number) => new Date(2026, 8, 4 + offset);

function database(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-bootstrap-read-model-"));
  const path = join(directory, "dayflow.db");
  execFileSync("sqlite3", ["-batch", "-bail", path], {
    input: readFileSync(join(process.cwd(), "prisma/init.sql")), stdio: "pipe"
  });
  const prisma = new PrismaClient({ datasourceUrl: `file:${path}` });
  context.after(async () => {
    try { await prisma.$disconnect(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
  return prisma;
}

test("bootstrap workspaceEmpty changes from true to false after one Task", async (context) => {
  const prisma = database(context);
  const empty = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.equal(empty.workspaceEmpty, true);
  assert.deepEqual(empty.tasks, []);
  await prisma.task.create({ data: { title: "First Task" } });
  const populated = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.equal(populated.workspaceEmpty, false);
});

test("bootstrap keeps payload key order and unsaved Diary and Review defaults", async (context) => {
  const prisma = database(context);
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(Object.keys(result), [
    "today", "todayKey", "earliestDayKey", "dayViewForwardWeeks", "tasks", "paletteTasks",
    "notes", "diary", "materials", "timeBlocks", "activities", "activityCategorySuggestions",
    "projects", "unfinishedTasks", "stats", "review", "reviewSummary", "workspaceEmpty"
  ]);
  assert.equal(result.today, today.toISOString());
  assert.equal(result.todayKey, "2026-09-04");
  assert.equal(result.dayViewForwardWeeks, 8);
  assert.deepEqual(result.diary, {
    id: null, date: today, content: "", reflection: "", mood: 3, energy: 3, persisted: false
  });
  assert.deepEqual(result.review, {
    id: null, periodStart: day(-6), periodEnd: day(1), narrative: "",
    nextPeriodIntention: "", persisted: false
  });
  const again = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.equal(again.workspaceEmpty, true, "defaults must not be persisted by a read");
});

test("bootstrap window includes overdue, unscheduled and queued Tasks with stable ordering", async (context) => {
  const prisma = database(context);
  await prisma.task.createMany({ data: [
    { id: "overdue", title: "Overdue", date: day(-40), status: "TODO" },
    { id: "unscheduled", title: "Backlog", date: null },
    { id: "queued", title: "Queued beyond window", date: day(20), focusQueuePosition: 0 },
    { id: "old-done", title: "Done last month", date: day(-35), status: "DONE" },
    { id: "start", title: "Inclusive start", date: day(-6), status: "DONE" },
    { id: "end", title: "Exclusive end", date: day(2) },
    { id: "tomorrow", title: "Tomorrow", date: day(1) },
    { id: "today-second", title: "Second", date: today, sortOrder: 2, createdAt: new Date(2026, 6, 1) },
    { id: "today-later", title: "Later", date: today, sortOrder: 1, createdAt: new Date(2026, 8, 2) },
    { id: "today-first", title: "First", date: today, sortOrder: 1, createdAt: new Date(2026, 8, 1) }
  ] });
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.tasks.map(task => task.id), [
    "unscheduled", "overdue", "start", "today-first", "today-later", "today-second", "tomorrow", "queued"
  ]);
});

test("bootstrap unfinishedTasks is exactly the dated pre-today not-DONE subset of tasks", async (context) => {
  const prisma = database(context);
  await prisma.task.createMany({ data: [
    { id: "old", title: "Old", date: day(-40) },
    { id: "yesterday", title: "In progress", date: day(-1), status: "IN_PROGRESS" },
    { id: "done", title: "Done", date: day(-1), status: "DONE" },
    { id: "backlog", title: "Backlog" },
    { id: "today", title: "Today", date: today },
    { id: "future", title: "Future", date: day(1) }
  ] });
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.unfinishedTasks.map(task => task.id), ["old", "yesterday"]);
  assert.deepEqual(result.unfinishedTasks, result.tasks.filter(task =>
    task.date !== null && task.date < today && task.status !== "DONE"));
});

test("bootstrap paletteTasks contains every open Task and only projected fields", async (context) => {
  const prisma = database(context);
  const project = await prisma.project.create({ data: { name: "Palette Project" } });
  await prisma.task.createMany({ data: [
    { id: "open", title: "Open", date: today, estimateMinutes: 75, sortOrder: 4,
      focusQueuePosition: 2, projectId: project.id, priority: "HIGH", actualMinutes: 15 },
    { id: "distant", title: "Distant", date: day(30), status: "IN_PROGRESS" },
    { id: "backlog", title: "Backlog" },
    { id: "done", title: "Done", date: today, status: "DONE" }
  ] });
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.paletteTasks.map(task => task.id).sort(), ["backlog", "distant", "open"]);
  for (const task of result.paletteTasks) {
    assert.deepEqual(Object.keys(task), [
      "id", "title", "date", "estimateMinutes", "sortOrder", "focusQueuePosition", "projectId"
    ]);
  }
  assert.deepEqual(result.paletteTasks.find(task => task.id === "open"), {
    id: "open", title: "Open", date: today, estimateMinutes: 75, sortOrder: 4,
    focusQueuePosition: 2, projectId: project.id
  });
});

test("bootstrap timeBlocks use the half-open interval today through today plus two days", async (context) => {
  const prisma = database(context);
  for (const offset of [-1, 0, 1, 2, 3]) {
    await prisma.timeBlock.create({ data: {
      id: `block-${offset}`, title: "Block", date: day(offset), startTime: "09:00", endTime: "10:00"
    } });
  }
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.timeBlocks.map(block => block.id), ["block-0", "block-1"]);
});

test("readTasksInDateRange returns exactly the half-open range in ascending date order", async (context) => {
  const prisma = database(context);
  const range = { start: day(-6), end: day(1) };
  await prisma.task.createMany({ data: [
    { id: "before", title: "Before range", date: day(-7) },
    { id: "interior", title: "Inside range", date: today, status: "DONE" },
    { id: "start", title: "Inclusive start", date: range.start },
    { id: "end", title: "Exclusive end", date: range.end },
    { id: "null-date", title: "Unscheduled", date: null }
  ] });
  const tasks = await prisma.$transaction(tx => readTasksInDateRange(tx, range));
  assert.deepEqual(tasks.map(task => task.id), ["start", "interior"]);
});

test("bootstrap stats cover the seven-day Review Period keyed by local day", async (context) => {
  const prisma = database(context);
  await prisma.task.createMany({ data: [
    { title: "Before period", date: day(-7), estimateMinutes: 600 },
    { title: "First day done", date: day(-6), status: "DONE", estimateMinutes: 45 },
    { title: "First day open", date: day(-6), estimateMinutes: 30 },
    { title: "Today done", date: today, status: "DONE", estimateMinutes: 90 },
    { title: "After period", date: day(1), estimateMinutes: 600 },
    { title: "Backlog", estimateMinutes: 600 }
  ] });
  await prisma.diaryEntry.create({ data: { date: day(-6), mood: 4, energy: 2 } });
  for (const [offset, minutes] of [[-7, 600], [-6, 40], [0, 35], [1, 600]]) {
    await prisma.activityEntry.create({ data: {
      // Late local time falls on the following UTC date in America/Chicago.
      startedAt: new Date(2026, 8, 4 + offset, 23, 30), durationMinutes: minutes,
      category: "Work", note: "Local day evidence"
    } });
  }
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.stats.map(stat => stat.day), [
    "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"
  ]);
  assert.deepEqual(result.stats[0], {
    day: "2026-08-29", completed: 1, total: 2, completionRate: 50,
    plannedHours: 1.3, actualHours: 0.7, mood: 4, energy: 2
  });
  assert.deepEqual(result.stats[6], {
    day: "2026-09-04", completed: 1, total: 1, completionRate: 100,
    plannedHours: 1.5, actualHours: 0.6, mood: null, energy: null
  });
  assert.equal(result.stats.reduce((sum, stat) => sum + stat.total, 0), 3);
  assert.equal(result.stats[1].completionRate, 0);
});

test("bootstrap earliestDayKey resolves empty, future-only and past evidence per navigation rules", async (context) => {
  const prisma = database(context);
  const read = () => prisma.$transaction(tx => readBootstrap(tx, now));
  assert.equal((await read()).earliestDayKey, resolveEarliestNavigableDayKey(null, now));
  await prisma.task.create({ data: { title: "Future", date: day(4) } });
  assert.equal((await read()).earliestDayKey, "2026-09-04");
  await prisma.task.create({ data: { title: "Past", date: day(-1) } });
  assert.equal((await read()).earliestDayKey, "2026-09-03");
  await prisma.activityEntry.create({ data: {
    startedAt: day(-2), durationMinutes: 30, category: "Work", note: "Earlier Activity"
  } });
  assert.equal((await read()).earliestDayKey, "2026-09-02");
  await prisma.timeBlock.create({ data: {
    date: day(-3), title: "Earliest Block", startTime: "09:00", endTime: "10:00"
  } });
  assert.equal((await read()).earliestDayKey, resolveEarliestNavigableDayKey("2026-09-01", now));
  assert.equal((await read()).earliestDayKey, "2026-09-01");
});

test("bootstrap sees earlier writes in its supplied transaction and leaves nothing after rollback", async (context) => {
  const prisma = database(context);
  const rollback = new Error("Roll back the caller's work");
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.task.create({ data: { id: "uncommitted", title: "Uncommitted", date: day(-1) } });
    await tx.diaryEntry.create({ data: { date: today, content: "Uncommitted Diary" } });
    const result = await readBootstrap(tx, now);
    assert.deepEqual(result.tasks.map(task => task.id), ["uncommitted"]);
    assert.equal(result.diary.content, "Uncommitted Diary");
    assert.equal(result.workspaceEmpty, false);
    assert.equal(result.earliestDayKey, "2026-09-03");
    throw rollback;
  }), error => error === rollback);
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.equal(result.workspaceEmpty, true);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.diary.persisted, false);
});

test("bootstrap preserves saved Diary and Review, parses tags and composes category suggestions", async (context) => {
  const prisma = database(context);
  const diary = await prisma.diaryEntry.create({ data: {
    date: today, content: "Written Diary", reflection: "A reflection", mood: 5, energy: 1
  } });
  const review = await prisma.review.create({ data: {
    periodStart: day(-6), periodEnd: day(1), narrative: "Written Review", nextPeriodIntention: "Next step"
  } });
  for (const [id, tags] of [["array", '["work",7]'], ["object", '{}'], ["broken", 'not JSON']]) {
    await prisma.note.create({ data: { id, date: today, content: id, tags } });
  }
  await prisma.note.create({ data: { id: "yesterday", date: day(-1), content: "Yesterday" } });
  await prisma.activityEntry.create({ data: {
    startedAt: today, durationMinutes: 20, category: "Custom Category", note: "Today's Activity"
  } });
  await prisma.activityEntry.create({ data: {
    startedAt: day(-10), durationMinutes: 20, category: "custom category", note: "Older spelling"
  } });
  const result = await prisma.$transaction(tx => readBootstrap(tx, now));
  assert.deepEqual(result.diary, { ...diary, persisted: true });
  assert.deepEqual(result.review, { ...review, persisted: true });
  assert.deepEqual(Object.keys(result.diary), [...Object.keys(diary), "persisted"]);
  assert.deepEqual(Object.keys(result.review), [...Object.keys(review), "persisted"]);
  assert.deepEqual(result.notes.map(note => note.id).sort(), ["array", "broken", "object"]);
  assert.deepEqual(result.notes.find(note => note.id === "array")?.tags, ["work", 7]);
  assert.deepEqual(result.notes.find(note => note.id === "object")?.tags, []);
  assert.deepEqual(result.notes.find(note => note.id === "broken")?.tags, []);
  assert.deepEqual(result.activityCategorySuggestions.slice(0, 5), [
    "Deep Work", "Learning", "Admin", "Health", "Rest"
  ]);
  assert.deepEqual(result.activityCategorySuggestions.filter(category =>
    category.toLowerCase() === "custom category"), ["custom category"]);
  assert.deepEqual(result.activities.map(activity => activity.note), ["Today's Activity"]);
});
