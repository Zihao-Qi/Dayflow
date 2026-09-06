import { appErrorResponse } from "@/lib/http-errors";
import { projectErrors } from "@/modules/projects/domain/project";
import { translateProjectPersistenceError, type ProjectMutationAction } from "@/modules/projects/services/projects";
import { getProjectDetail as readDetail } from "@/server/read-models/project-detail";
import { AppError } from "@/shared/kernel/errors";

export { createProject, updateProject, createPhase, updatePhase } from "@/modules/projects/services/projects";
export { listProjectSummaries } from "@/server/read-models/project-summaries";
export { deleteProject as deleteProjectSafely } from "@/server/workflows/delete-project";
export { deletePhase as deletePhaseSafely } from "@/server/workflows/delete-phase";

// Preserve the legacy argument order only at the compatibility boundary.
export function getProjectDetail(id: string, database: Parameters<typeof readDetail>[0], period: Parameters<typeof readDetail>[2]) {
  return readDetail(database, id, period);
}

export function projectMutationErrorResponse(error: unknown, action: ProjectMutationAction) {
  const translated = translateProjectPersistenceError(error, action);
  if (translated instanceof AppError) return appErrorResponse(translated);
  const fallback = {
    create: projectErrors.projectCouldNotBeCreated,
    save: projectErrors.projectCouldNotBeSaved,
    delete: projectErrors.projectCouldNotBeDeleted,
    "phase-create": projectErrors.phaseCouldNotBeCreated,
    "phase-save": projectErrors.phaseCouldNotBeSaved,
    "phase-delete": projectErrors.phaseCouldNotBeDeleted
  };
  console.error(`Project boundary ${action} failed.`, error);
  return appErrorResponse(new AppError(fallback[action]));
}
