import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectTaskRecord } from "../../src/lib/project-domain";
import {
  createProjectRowPlan,
  projectPlanKey,
  type ProjectPlanDetail,
  type ProjectRowPlanState
} from "../../src/modules/projects/ui/project-row-plan";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(turns = 25): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createTask(id: string, overrides: Partial<ProjectTaskRecord> = {}): ProjectTaskRecord {
  return {
    id,
    title: `Task ${id}`,
    status: "TODO",
    priority: "MEDIUM",
    urgentScore: 0,
    importanceScore: 0,
    deadline: null,
    estimateMinutes: 30,
    actualMinutes: 0,
    sortOrder: 0,
    completedAt: null,
    projectId: "proj-106",
    phaseId: null,
    date: null,
    ...overrides
  };
}

type Counts = {
  taskCount?: number;
  completedTaskCount?: number;
  nextTaskId?: string | null;
  progressPercent?: number | null;
};

function createPlanDetail(tasks: ProjectTaskRecord[], counts: Counts = {}): ProjectPlanDetail {
  return {
    tasks,
    phases: [],
    taskCount: counts.taskCount ?? tasks.length,
    completedTaskCount:
      counts.completedTaskCount ?? tasks.filter((t) => t.status === "DONE").length,
    nextTaskId: counts.nextTaskId ?? (tasks[0]?.id ?? null),
    progressPercent: counts.progressPercent ?? 0
  };
}

const LOAD_FAILED = "These tasks could not be loaded. Try again.";

function createHarness(initialKey: string) {
  const reads: Deferred<ProjectPlanDetail>[] = [];
  const refreshes: Deferred<void>[] = [];
  const states: ProjectRowPlanState[] = [];
  const view = { summaryKey: initialKey, expanded: false };

  const row = createProjectRowPlan({
    summaryKey: initialKey,
    readPlan: () => {
      const d = deferred<ProjectPlanDetail>();
      reads.push(d);
      return d.promise;
    },
    refreshSummary: () => {
      const d = deferred<void>();
      refreshes.push(d);
      return d.promise;
    },
    view: () => view,
    onChange: (state) => {
      states.push(state);
    }
  });

  return {
    row,
    reads,
    refreshes,
    view,
    states,
    getPublishedTaskIds: () => (row.getState().plan?.tasks ?? []).map((t) => t.id),
    getState: () => row.getState()
  };
}

async function openDrawerWithInitialTask(h: ReturnType<typeof createHarness>, initialTask: ProjectTaskRecord) {
  h.view.expanded = true;
  h.row.toggle(true);
  h.row.observe();
  await flush();

  assert.equal(h.reads.length, 1, "opening drawer starts initial detail read");
  h.reads[0].resolve(
    createPlanDetail([initialTask], {
      taskCount: 1,
      completedTaskCount: 0,
      nextTaskId: initialTask.id,
      progressPercent: 0
    })
  );
  await flush();
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask.id]);
}

test("Scenario 1: S1 resurrection defect after external deletion (Issue #106)", async () => {
  const initialTask = createTask("task-existing-1");
  const createdTask = createTask("task-created-2");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  // User submits a create mutation
  const createPromise = h.row.create(async () => createdTask);
  await flush();

  assert.equal(h.reads.length, 2, "create mutation starts its own plan read");
  assert.equal(h.refreshes.length, 1, "create mutation starts summary refresh");

  // Own read resolves with created task published
  const c1: Counts = { taskCount: 2, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  h.reads[1].resolve(createPlanDetail([initialTask, createdTask], c1));
  await flush();
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask.id, createdTask.id], "own read published created task");

  // While refresh is in flight, external mutation deletes the created task: summary moves
  h.view.summaryKey = projectPlanKey({ taskCount: 2, completedTaskCount: 1, nextTaskId: initialTask.id, progressPercent: 50 });
  h.row.observe();
  await flush();
  assert.equal(h.reads.length, 2, "summary change observed during refresh is retained without triggering extra read");

  // Initial summary refresh resolves
  h.refreshes[0].resolve();
  await flush();

  // Reconciliation reads retained change (read 3)
  assert.equal(h.reads.length, 3, "reconciliation starts read for retained summary change");

  // Another change happens while read 3 is in flight
  h.view.summaryKey = projectPlanKey({ taskCount: 1, completedTaskCount: 1, nextTaskId: null, progressPercent: 100 });
  h.row.observe();
  await flush();
  assert.equal(h.reads.length, 3, "second change while read 3 in flight is retained");

  // Read 3 resolves showing created task was deleted externally
  h.reads[2].resolve(createPlanDetail([initialTask], c0));
  await flush();
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask.id], "newer authoritative read removed the created task");

  // Reconciliation re-reads for second retained change (read 4)
  assert.equal(h.reads.length, 4, "reconciliation starts read 4 for second retained change");

  // Read 4 fails
  h.reads[3].reject(new Error("trailing reconciliation read network error"));
  await flush();
  assert.equal(h.getState().loadError, LOAD_FAILED, "trailing read failure published loadError");

  // Create mutation promise settles
  const confirmed = await createPromise;
  await flush();
  assert.equal(confirmed, true, "server create was confirmed");

  // DEFECT GUARD: Trailing read failure must NOT cause fallback merge to resurrect the deleted task!
  assert.deepEqual(
    h.getPublishedTaskIds(),
    [initialTask.id],
    "delayed create completion must NOT resurrect the externally deleted task"
  );
  assert.equal(h.reads.length, 4, "total detail GETs is bounded to 4");
});

test("Scenario 2: S2 legitimate own-read failure fallback (#49 S4)", async () => {
  const initialTask = createTask("task-existing-1");
  const createdTask = createTask("task-created-2");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  const createPromise = h.row.create(async () => createdTask);
  await flush();

  assert.equal(h.reads.length, 2, "create starts own read");
  assert.equal(h.refreshes.length, 1, "create starts summary refresh");

  // Own read fails while it is the latest read
  h.reads[1].reject(new Error("own read network failure"));
  await flush();

  // Summary refresh succeeds
  h.refreshes[0].resolve();
  await flush();

  const confirmed = await createPromise;
  await flush();

  assert.equal(confirmed, true, "create write succeeded");
  assert.equal(h.getState().loadError, LOAD_FAILED, "loadError published for own read failure");
  // Legitimate fallback: since own read failed and was still latest, confirmed task is merged
  assert.deepEqual(
    h.getPublishedTaskIds(),
    [initialTask.id, createdTask.id],
    "confirmed task is merged into published state when own read failed while latest"
  );
});

test("Scenario 3a: S3a own read superseded then fails", async () => {
  const initialTask = createTask("task-existing-1");
  const createdTask = createTask("task-created-2");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  const createPromise = h.row.create(async () => createdTask);
  await flush();

  // Newer read starts before own read settles (e.g. user triggers retry)
  h.row.retry();
  await flush();
  assert.equal(h.reads.length, 3, "retry started read 3 while own read 2 was in flight");

  // Own read 2 fails after being superseded
  h.reads[1].reject(new Error("own read failed after being superseded"));
  await flush();

  // Read 3 succeeds and publishes
  h.reads[2].resolve(createPlanDetail([initialTask], c0));
  await flush();

  // Summary refresh finishes
  h.refreshes[0].resolve();
  await flush();

  const confirmed = await createPromise;
  await flush();

  assert.equal(confirmed, true, "create write succeeded");
  // Superseded own read must NOT trigger fallback merge
  assert.deepEqual(
    h.getPublishedTaskIds(),
    [initialTask.id],
    "superseded own read must not trigger fallback merge over authoritative read"
  );
});

test("Scenario 3b: S3b own read fails while latest, then overtaken before completion", async () => {
  const initialTask = createTask("task-existing-1");
  const createdTask = createTask("task-created-2");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  const createPromise = h.row.create(async () => createdTask);
  await flush();

  // Own read fails while latest
  h.reads[1].reject(new Error("own read fails"));
  await flush();
  assert.equal(h.getState().loadError, LOAD_FAILED, "own read failure published error");

  // Before create completes (summary refresh is still in flight), user clicks retry -> read 3 starts
  h.row.retry();
  await flush();
  assert.equal(h.reads.length, 3, "retry started read 3 before create completed");

  // Read 3 settles with server state
  h.reads[2].resolve(createPlanDetail([initialTask], c0));
  await flush();

  // Summary refresh finishes
  h.refreshes[0].resolve();
  await flush();

  const confirmed = await createPromise;
  await flush();

  assert.equal(confirmed, true);
  // Newer read that started after the failure is the authority: fallback merge must NOT happen
  assert.deepEqual(
    h.getPublishedTaskIds(),
    [initialTask.id],
    "newer read started after failure is authority; fallback merge must not happen"
  );
});

test("Scenario 4: S4 ordinary bootstrap-first mutation makes zero redundant trailing reads", async () => {
  const initialTask = createTask("task-existing-1");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  const newTask = createTask("task-new-2");
  const c1: Counts = { taskCount: 2, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };

  const updatePromise = h.row.update(async () => ({ ok: true }));
  await flush();

  // Overview refresh settles first with summary key for 2 tasks
  h.view.summaryKey = projectPlanKey(c1);
  h.refreshes[0].resolve();
  h.row.observe();
  await flush();

  // Detail read 2 resolves with updated tasks and matching summary counts c1
  h.reads[1].resolve(createPlanDetail([initialTask, newTask], c1));
  await flush();

  assert.equal(h.reads.length, 2, "ordinary bootstrap-first mutation requires no extra trailing reads");

  await updatePromise;
  await flush();

  assert.deepEqual(h.getPublishedTaskIds(), [initialTask.id, newTask.id]);
});

test("Scenario 5: lost-delete response reconciliation (remove)", async () => {
  const initialTask1 = createTask("task-1");
  const taskToDelete = createTask("task-2");
  const c0: Counts = { taskCount: 2, completedTaskCount: 0, nextTaskId: initialTask1.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  h.view.expanded = true;
  h.row.toggle(true);
  h.row.observe();
  await flush();
  h.reads[0].resolve(createPlanDetail([initialTask1, taskToDelete], c0));
  await flush();
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask1.id, taskToDelete.id]);

  // DELETE write throws (simulating dropped response / network timeout after server committed)
  const removePromise = h.row.remove(taskToDelete.id, async () => {
    throw new Error("HTTP 504 Gateway Timeout (lost response)");
  });
  await flush();

  // Seam reconciles: read settles before overview refresh starts
  assert.equal(h.reads.length, 2, "lost delete triggers reconciliation read");
  assert.equal(
    h.refreshes.length,
    0,
    "overview refresh must not start while reconciliation read is pending"
  );

  // Read 2 confirms task-2 is gone on server
  const c1: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask1.id, progressPercent: 0 };
  h.reads[1].resolve(createPlanDetail([initialTask1], c1));
  await flush();

  // Now overview refresh starts
  assert.equal(h.refreshes.length, 1, "overview refresh starts after read settles");
  h.refreshes[0].resolve();
  await flush();

  const removed = await removePromise;
  await flush();

  assert.equal(removed, true, "remove resolves true when task is confirmed absent on server");
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask1.id], "task is removed from published state");
  assert.equal(h.getState().editError, "", "editError is cleared because task was confirmed deleted");
});

test("Scenario 6: failed delete where task remains on server", async () => {
  const initialTask1 = createTask("task-1");
  const taskToDelete = createTask("task-2");
  const c0: Counts = { taskCount: 2, completedTaskCount: 0, nextTaskId: initialTask1.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  h.view.expanded = true;
  h.row.toggle(true);
  h.row.observe();
  await flush();
  h.reads[0].resolve(createPlanDetail([initialTask1, taskToDelete], c0));
  await flush();

  const removePromise = h.row.remove(taskToDelete.id, async () => {
    throw new Error("500 Internal Server Error");
  });
  await flush();

  assert.equal(h.reads.length, 2, "failed delete triggers reconciliation read");

  // Read confirms task-2 is STILL on server
  h.reads[1].resolve(createPlanDetail([initialTask1, taskToDelete], c0));
  await flush();
  h.refreshes[0].resolve();
  await flush();

  const removed = await removePromise;
  await flush();

  assert.equal(removed, false, "remove resolves false when task is still present on server");
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask1.id, taskToDelete.id], "task remains in plan");
  assert.equal(
    h.getState().editError,
    "The change could not be saved. Your draft is still here."
  );
});

test("Scenario 7: failed create write does not start refresh", async () => {
  const initialTask = createTask("task-existing-1");
  const c0: Counts = { taskCount: 1, completedTaskCount: 0, nextTaskId: initialTask.id, progressPercent: 0 };
  const initialKey = projectPlanKey(c0);

  const h = createHarness(initialKey);
  await openDrawerWithInitialTask(h, initialTask);

  const created = await h.row.create(async () => {
    throw new Error("Validation error: title required");
  });
  await flush();

  assert.equal(created, false, "failed create resolves false");
  assert.equal(h.reads.length, 1, "no new read started");
  assert.equal(h.refreshes.length, 0, "no refresh started");
  assert.equal(h.getState().editError, "The change could not be saved. Your draft is still here.");
  assert.deepEqual(h.getPublishedTaskIds(), [initialTask.id]);
});
