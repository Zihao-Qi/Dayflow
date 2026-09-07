import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { addDays, localDateKey, reviewPeriodRange, startOfLocalDay } from "../../src/lib/dates";
import { activityHeaders, parseCsv, taskHeaders } from "../csv-test-helpers";

test("bootstrap, agent export, and CSV preserve their seeded read contracts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-read-route-contracts-"));
  const databasePath = join(directory, "dayflow.db");
  const previousUrl = process.env.DATABASE_URL;
  const globalClient = globalThis as unknown as { prisma?: PrismaClient };
  const previousClient = globalClient.prisma;
  process.env.DATABASE_URL = `file:${databasePath}`;
  const database = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  globalClient.prisma = database;
  const queries: string[] = [];
  database.$on("query", ({ query }) => queries.push(query));
  context.after(async () => {
    try {
      await database.$disconnect();
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousClient === undefined) delete globalClient.prisma;
      else globalClient.prisma = previousClient;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
    input: readFileSync(join(process.cwd(), "prisma/init.sql")),
    stdio: ["pipe", "pipe", "pipe"]
  });

  const today = startOfLocalDay(new Date());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const period = reviewPeriodRange(today);
  const project = await database.project.create({ data: { name: "Read contracts" } });
  const phase = await database.projectPhase.create({
    data: { name: "First phase", projectId: project.id }
  });
  const task = await database.task.create({
    data: { title: "Today's plan", date: today, projectId: project.id, phaseId: phase.id }
  });
  const overdue = await database.task.create({
    data: { title: "Still unfinished", date: yesterday }
  });
  const future = await database.task.create({
    data: { title: "Tomorrow's plan", date: tomorrow }
  });
  const change = await database.taskScheduleChange.create({
    data: { taskId: task.id, previousDate: yesterday, nextDate: today }
  });
  const note = await database.note.create({
    data: { date: today, content: "Tagged note", tags: '["contract","read"]', taskId: task.id }
  });
  const diary = await database.diaryEntry.create({
    data: { date: today, content: "Saved diary", mood: 4, energy: 5 }
  });
  const review = await database.review.create({
    data: { periodStart: period.start, periodEnd: period.end, narrative: "Saved review" }
  });
  const material = await database.material.create({
    data: { title: "Reference", url: "https://example.com", taskId: task.id }
  });
  const block = await database.timeBlock.create({
    data: { date: today, startTime: "09:00", endTime: "10:00", title: "Plan", taskId: task.id }
  });
  const session = await database.focusSession.create({
    data: { plannedMinutes: 25, startedAt: today, status: "COMPLETED", taskId: task.id }
  });
  const activity = await database.activityEntry.create({
    data: {
      startedAt: today, durationMinutes: 25, category: "Deep Work", note: "Recorded",
      taskId: task.id, attributedProjectId: project.id, focusSessionId: session.id, origin: "FOCUS"
    }
  });
  // Export remains complete, while bootstrap's daily and review evidence exclude tomorrow.
  const futureActivity = await database.activityEntry.create({
    data: { startedAt: tomorrow, durationMinutes: 60, category: "Learning", note: "Future row" }
  });

  const [{ GET: bootstrap }, { GET: agentExport }, { GET: csvExport }] = await Promise.all([
    import("../../src/app/api/bootstrap/route"),
    import("../../src/app/api/agent-export/route"),
    import("../../src/app/api/exports/[kind]/route")
  ]);

  // Transaction clients have their own delegates. Any helper that escapes to
  // the singleton must fail, even if its SELECT lands between BEGIN and COMMIT.
  for (const delegate of [
    database.project, database.projectPhase, database.focusSession, database.task,
    database.taskScheduleChange, database.note, database.diaryEntry, database.review,
    database.material, database.timeBlock, database.activityEntry
  ]) {
    for (const method of ["findMany", "findFirst", "findUnique"] as const) {
      const original = delegate[method];
      Object.assign(delegate, {
        [method]: () => { throw new Error(`Read escaped the route transaction: ${method}`); }
      });
      context.after(() => { Object.assign(delegate, { [method]: original }); });
    }
  }

  function assertSingleReadTransaction() {
    assert.match(queries[0], /^BEGIN/);
    assert.equal(queries.at(-1), "COMMIT");
    assert.equal(queries.filter((query) => /^BEGIN/.test(query)).length, 1);
    assert.ok(queries.slice(1, -1).length > 0);
    assert.ok(queries.slice(1, -1).every((query) => /^SELECT/.test(query)),
      "all payload queries are reads between BEGIN and COMMIT");
  }

  await context.test("bootstrap keeps its keys, collections, and derived values", async () => {
    queries.length = 0;
    const response = await bootstrap();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), [
      "today", "todayKey", "earliestDayKey", "dayViewForwardWeeks", "tasks", "paletteTasks",
      "notes", "diary", "materials", "timeBlocks", "activities", "activityCategorySuggestions",
      "projects", "unfinishedTasks", "stats", "review", "reviewSummary", "workspaceEmpty"
    ]);
    for (const key of [
      "tasks", "paletteTasks", "notes", "materials", "timeBlocks", "activities",
      "activityCategorySuggestions", "projects", "unfinishedTasks", "stats"
    ]) {
      assert.ok(Array.isArray(body[key]) && body[key].length > 0, `${key} is populated`);
    }
    assert.deepEqual(body.tasks.map((row: { id: string }) => row.id), [overdue.id, task.id, future.id]);
    assert.deepEqual(body.unfinishedTasks.map((row: { id: string; date: string }) => [row.id, row.date]),
      [[overdue.id, yesterday.toISOString()]]);
    assert.deepEqual(body.notes[0].tags, ["contract", "read"]);
    assert.equal(body.notes[0].id, note.id);
    assert.equal(body.diary.id, diary.id);
    assert.equal(body.diary.persisted, true);
    assert.equal(body.review.id, review.id);
    assert.equal(body.review.persisted, true);
    assert.equal(body.materials[0].id, material.id);
    assert.equal(body.timeBlocks[0].id, block.id);
    assert.equal(body.timeBlocks[0].date, localDateKey(today));
    assert.equal(body.timeBlocks[0].task.id, task.id);
    assert.deepEqual(body.activities.map((row: { id: string }) => row.id), [activity.id]);
    assert.equal(body.projects[0].id, project.id);
    assert.equal(body.projects[0].investedMinutes, 25);
    assert.equal(body.projects[0].phaseCount, 1);
    assert.equal(body.reviewSummary.recordedMinutes, 25);
    assert.deepEqual(body.reviewSummary.categoryMinutes, [{ category: "Deep Work", minutes: 25 }]);
    assert.equal(body.stats.length, 7);
    assert.equal(body.today, today.toISOString());
    assert.equal(body.todayKey, localDateKey(today));
    assert.equal(body.earliestDayKey, localDateKey(yesterday));
    assert.equal(body.workspaceEmpty, false);
    assertSingleReadTransaction();
  });

  await context.test("agent export keeps its keys and every persisted collection", async () => {
    queries.length = 0;
    const response = await agentExport();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), [
      "app", "exportFormat", "exportVersion", "exportedAt", "purpose", "schemaVersion",
      "projects", "phases", "focusSessions", "tasks", "scheduleChanges", "notes",
      "diaryEntries", "reviews", "materials", "timeBlocks", "activities"
    ]);
    const expectedIds = {
      projects: [project.id], phases: [phase.id], focusSessions: [session.id],
      tasks: [overdue.id, task.id, future.id], scheduleChanges: [change.id], notes: [note.id],
      diaryEntries: [diary.id], reviews: [review.id], materials: [material.id],
      timeBlocks: [block.id], activities: [activity.id, futureActivity.id]
    };
    for (const [key, ids] of Object.entries(expectedIds)) {
      assert.ok(Array.isArray(body[key]), `${key} is a collection`);
      assert.deepEqual(body[key].map((row: { id: string }) => row.id), ids, key);
    }
    assert.equal(body.app, "Dayflow");
    assert.equal(body.exportFormat, "dayflow-json");
    assert.equal(body.exportVersion, 1);
    assert.equal(body.schemaVersion, 6);
    assert.equal(body.purpose, "Complete local-first productivity data for analysis and external agents.");
    assert.equal(new Date(body.exportedAt).toISOString(), body.exportedAt);
    assert.deepEqual(body.notes[0].tags, ["contract", "read"]);
    assert.equal(body.timeBlocks[0].date, today.toISOString());
    assertSingleReadTransaction();
  });

  for (const kind of ["tasks", "activities"] as const) {
    await context.test(`CSV ${kind} reads ordered rows and relationships through SQLite`, async () => {
      queries.length = 0;
      const response = await csvExport(
        new Request(`http://localhost/api/exports/${kind}`),
        { params: Promise.resolve({ kind }) }
      );
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
      assert.equal(bytes.subarray(-2).toString(), "\r\n");
      const [headers, ...rows] = parseCsv(bytes.toString("utf8"));
      assert.deepEqual(headers, kind === "tasks" ? taskHeaders : activityHeaders);
      const expectedIds = kind === "tasks"
        ? [task, overdue, future].sort((left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
        ).map(({ id }) => id)
        : [activity.id, futureActivity.id];
      assert.deepEqual(rows.map(([id]) => id), expectedIds);
      assert.equal(response.headers.get("X-Dayflow-Record-Count"), String(expectedIds.length));
      const linkedRow = rows.find(([id]) => id === (kind === "tasks" ? task.id : activity.id))!;
      const values = Object.fromEntries(headers.map((header, index) => [header, linkedRow[index]]));
      if (kind === "tasks") {
        assert.equal(values.project_name, project.name);
        assert.equal(values.phase_name, phase.name);
        assert.equal(values.scheduled_date, localDateKey(today));
      } else {
        assert.equal(values.task_title, task.title);
        assert.equal(values.attributed_project_name, project.name);
        assert.equal(values.started_at_utc, today.toISOString());
      }
      assertSingleReadTransaction();
    });
  }
});
