import type { ErrorSpec } from "@/shared/kernel/errors";
import { projectErrors, type ProjectStatus } from "./project";

/**
 * What a Project's lifecycle state lets its plan take on.
 *
 * A Completed or Archived Project keeps its plan editable: existing tasks can
 * be finished, corrected, re-phased, scheduled, focused and deleted, and
 * phases can be created, renamed and deleted. What it refuses, until it is
 * explicitly reopened or restored, is gaining an unfinished task. See
 * `docs/specs/PROJECTS_V1.md`, "Plan changes by lifecycle state".
 */
export type ProjectReactivation = { action: "Reopen" | "Restore"; error: ErrorSpec };

const reactivationByStatus: Record<ProjectStatus, ProjectReactivation | null> = {
  ACTIVE: null,
  PAUSED: null,
  COMPLETED: { action: "Reopen", error: projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork },
  ARCHIVED: { action: "Restore", error: projectErrors.restoreTheArchivedProjectBeforeAddingUnfinishedWork }
};

/** The explicit action a Project needs before it can gain an unfinished task, or null when it needs none. */
export function projectReactivation(status: ProjectStatus): ProjectReactivation | null {
  return reactivationByStatus[status];
}

/** A Task's placement, as far as its Project's lifecycle is concerned. */
export type TaskPlacement = { projectId: string | null; status: string };

/**
 * Whether a Task going from `before` (null for a new Task) to `after` gives
 * `after.projectId` an unfinished Task it did not already hold: a new
 * unfinished Task, an unfinished Task moved in from elsewhere, or a done Task
 * made unfinished again. Any other edit to an unfinished Task that stays in
 * its Project gains nothing.
 */
export function gainsUnfinishedTask(before: TaskPlacement | null, after: TaskPlacement) {
  if (after.projectId === null || after.status === "DONE") return false;
  return before === null || before.projectId !== after.projectId || before.status === "DONE";
}
