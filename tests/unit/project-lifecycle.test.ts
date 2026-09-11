import assert from "node:assert/strict";
import test from "node:test";
import {
  projectReactivation,
  gainsUnfinishedTask
} from "../../src/modules/projects/domain/lifecycle";
import { projectErrors } from "../../src/modules/projects/domain/project";

test("projectReactivation requires Reopen for COMPLETED and Restore for ARCHIVED, null for ACTIVE and PAUSED", () => {
  assert.equal(projectReactivation("ACTIVE"), null);
  assert.equal(projectReactivation("PAUSED"), null);

  const completed = projectReactivation("COMPLETED");
  assert.ok(completed);
  assert.equal(completed.action, "Reopen");
  assert.deepEqual(
    completed.error,
    projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork
  );

  const archived = projectReactivation("ARCHIVED");
  assert.ok(archived);
  assert.equal(archived.action, "Restore");
  assert.deepEqual(
    archived.error,
    projectErrors.restoreTheArchivedProjectBeforeAddingUnfinishedWork
  );
});

test("gainsUnfinishedTask returns true only when a project gains an unfinished task it did not already hold", () => {
  const p1 = "project-1";
  const p2 = "project-2";

  // Standalone tasks never give a project an unfinished task
  assert.equal(gainsUnfinishedTask(null, { projectId: null, status: "TODO" }), false);
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "TODO" }, { projectId: null, status: "TODO" }),
    false
  );

  // Finishing a task (TODO -> DONE) or editing an already-DONE task never gains unfinished work
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "TODO" }, { projectId: p1, status: "DONE" }),
    false
  );
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "DONE" }, { projectId: p1, status: "DONE" }),
    false
  );
  assert.equal(gainsUnfinishedTask(null, { projectId: p1, status: "DONE" }), false);
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "DONE" }, { projectId: p2, status: "DONE" }),
    false
  );

  // Creating a new unfinished task in a project gains an unfinished task
  assert.equal(gainsUnfinishedTask(null, { projectId: p1, status: "TODO" }), true);

  // Moving an unfinished task into a project gains an unfinished task for that project
  assert.equal(
    gainsUnfinishedTask({ projectId: null, status: "TODO" }, { projectId: p1, status: "TODO" }),
    true
  );
  assert.equal(
    gainsUnfinishedTask({ projectId: p2, status: "TODO" }, { projectId: p1, status: "TODO" }),
    true
  );

  // Reopening a DONE task within a project (DONE -> TODO) gains an unfinished task
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "DONE" }, { projectId: p1, status: "TODO" }),
    true
  );

  // In-place edits to an existing unfinished task in the same project do NOT gain an unfinished task
  // (Control against gains = after.status !== "DONE")
  assert.equal(
    gainsUnfinishedTask({ projectId: p1, status: "TODO" }, { projectId: p1, status: "TODO" }),
    false
  );
});
