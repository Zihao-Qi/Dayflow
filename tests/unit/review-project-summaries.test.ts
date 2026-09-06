import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import type { SummaryInput } from "../../src/modules/projects/domain/project";
import { readReviewPeriodEvidence } from "../../src/modules/review/services/reviews";
import { listProjectSummaries } from "../../src/server/read-models/project-summaries";

const period = {
  start: new Date("2026-08-29T05:00:00.000Z"),
  end: new Date("2026-09-05T05:00:00.000Z")
};
type ProjectRow = Omit<SummaryInput, "tasks" | "attributedActivities">;
type TaskRow = SummaryInput["tasks"][number] & { projectId: string | null };
type ActivityRow = SummaryInput["attributedActivities"][number] & {
  projectId: string | null;
  attributedProjectId: string | null;
};
const project = (id: string): ProjectRow => ({
  id, name: id, desiredOutcome: "Outcome", targetDate: null,
  targetDurationValue: null, targetDurationUnit: null, weeklyMinutesBudget: null,
  status: "ACTIVE", createdAt: period.start, updatedAt: period.start, phases: []
});
const task = (id: string, projectId: string | null, overrides: Partial<TaskRow> = {}): TaskRow => ({
  id, projectId, title: id, status: "TODO", date: null,
  estimateMinutes: 15, completedAt: null, ...overrides
});
const activity = (id: string, projectId: string | null, attributedProjectId: string | null,
  durationMinutes: number, startedAt = period.start): ActivityRow => ({
  id, projectId, attributedProjectId, durationMinutes, startedAt
});

// Return distinct rows for Review's period evidence reads and its project reads.
function database(projects: ProjectRow[], tasks: TaskRow[], activities: ActivityRow[]) {
  return {
    project: { findMany: async () => projects },
    task: { findMany: async (args: Prisma.TaskFindManyArgs) => args.where?.projectId ? tasks : [] },
    activityEntry: { findMany: async (args: Prisma.ActivityEntryFindManyArgs) =>
      args.where?.attributedProjectId ? activities : [] },
    diaryEntry: { findMany: async () => [] },
    note: { findMany: async () => [] },
    material: { findMany: async () => [] }
  } as unknown as Prisma.TransactionClient;
}

function expectedProject(row: ProjectRow, metrics: Record<string, unknown> = {}) {
  const { phases, ...fields } = row;
  return {
    ...fields, completedTaskCount: 0, taskCount: 0, progressPercent: null,
    phaseCount: phases.length, backlogCount: 0, investedMinutes: 0,
    reviewPeriodInvestedMinutes: 0, movedDuringReviewPeriod: false,
    nextTaskId: null, nextTaskTitle: null, nextTaskEstimateMinutes: null,
    lastProgressAt: null, ...metrics
  };
}

test("Review preserves exact project summaries, interleaved row order, attribution and period bounds", async () => {
  const projects = [project("z"), project("empty"), project("a"), project("tasks-only"), project("activities-only")];
  const tasks = [
    task("z-first", "z", { date: period.start }),
    task("a-done", "a", { status: "DONE", completedAt: period.start }),
    task("z-second", "z", { date: period.start }),
    task("a-backlog-first", "a"), task("z-done", "z", { status: "DONE", completedAt: period.end }),
    task("a-backlog-second", "a"), task("unlinked-task", null),
    task("tasks-only-done", "tasks-only", { status: "DONE", completedAt: period.start })
  ];
  const before = new Date(period.start.getTime() - 1);
  const activities = [
    activity("a-direct", "a", "a", 11),
    activity("z-attributed", null, "z", 13),
    activity("a-before", "z", "a", 17, before),
    activity("z-end", "a", "z", 19, period.end),
    activity("a-attributed", "z", "a", 23),
    activity("outside-period", null, "activities-only", 29, period.end),
    // These extra returned rows must never fall back to their direct project.
    activity("unattributed", "empty", null, 1000),
    activity("unknown-attribution", "empty", "unknown", 2000)
  ];
  const snapshot = JSON.stringify({ projects, tasks, activities });
  const activityVisits: string[] = [];
  const observed = activities.map(row => new Proxy(row, { get(target, key, receiver) {
    if (key === "durationMinutes") activityVisits.push(target.id);
    return Reflect.get(target, key, receiver);
  } }));
  const db = database(projects, tasks, observed);
  const result = await readReviewPeriodEvidence(db, period);
  assert.deepEqual(result.projects, [
    expectedProject(projects[0], { completedTaskCount: 1, taskCount: 3, progressPercent: 33,
      investedMinutes: 32, reviewPeriodInvestedMinutes: 13, movedDuringReviewPeriod: true,
      nextTaskId: "z-first", nextTaskTitle: "z-first", nextTaskEstimateMinutes: 15,
      lastProgressAt: period.end }),
    expectedProject(projects[1]),
    expectedProject(projects[2], { completedTaskCount: 1, taskCount: 3, progressPercent: 33,
      backlogCount: 2, investedMinutes: 51, reviewPeriodInvestedMinutes: 34,
      movedDuringReviewPeriod: true, nextTaskId: "a-backlog-first", nextTaskTitle: "a-backlog-first",
      nextTaskEstimateMinutes: 15, lastProgressAt: period.start }),
    expectedProject(projects[3], { completedTaskCount: 1, taskCount: 1, progressPercent: 100,
      movedDuringReviewPeriod: true, lastProgressAt: period.start }),
    expectedProject(projects[4], { investedMinutes: 29, lastProgressAt: period.end })
  ]);
  assert.equal(result.summary.movedProjectCount, 3);
  // Summation visits retain source order, including activities outside the period.
  assert.deepEqual(activityVisits, ["z-attributed", "z-end", "z-attributed",
    "a-direct", "a-before", "a-attributed", "a-direct", "a-attributed", "outside-period"]);
  assert.deepEqual(result.projects, await listProjectSummaries(database(projects, tasks, activities), period));
  assert.equal(JSON.stringify({ projects, tasks, activities }), snapshot);
});

test("Review reads each returned grouping key once regardless of project count", async () => {
  for (const projectCount of [4, 32, 128]) {
    const projects = Array.from({ length: projectCount }, (_, index) => project(`p-${index}`));
    let taskKeys = 0;
    let activityKeys = 0;
    const tasks = Array.from({ length: projectCount * 3 }, (_, index) => {
      const row = task(`t-${index}`, projects[index % projectCount].id);
      return new Proxy(row, { get(target, key, receiver) {
        if (key === "projectId") taskKeys++;
        return Reflect.get(target, key, receiver);
      } });
    });
    const activities = Array.from({ length: projectCount * 2 }, (_, index) => {
      const row = activity(`a-${index}`, null, projects[index % projectCount].id, 1);
      return new Proxy(row, { get(target, key, receiver) {
        if (key === "attributedProjectId") activityKeys++;
        return Reflect.get(target, key, receiver);
      } });
    });
    const result = await readReviewPeriodEvidence(database(projects, tasks, activities), period);
    assert.equal(result.projects.length, projectCount);
    assert.equal(taskKeys, tasks.length, `${projectCount} projects: Task grouping key reads`);
    assert.equal(activityKeys, activities.length, `${projectCount} projects: Activity grouping key reads`);
    assert.ok(result.projects.every(row => row.taskCount === 3 && row.investedMinutes === 2));
  }
});

test("Review with no projects skips both project row reads", async () => {
  const db = database([], [], []);
  db.task.findMany = (async (args: Prisma.TaskFindManyArgs) => {
    assert.equal(args.where?.projectId, undefined, "must not read project tasks");
    return [];
  }) as typeof db.task.findMany;
  db.activityEntry.findMany = (async (args: Prisma.ActivityEntryFindManyArgs) => {
    assert.equal(args.where?.attributedProjectId, undefined, "must not read project activities");
    return [];
  }) as typeof db.activityEntry.findMany;
  const result = await readReviewPeriodEvidence(db, period);
  assert.deepEqual(result.projects, []);
  assert.equal(result.summary.movedProjectCount, 0);
});
