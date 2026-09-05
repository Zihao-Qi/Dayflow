import { appErrorConstructor } from "@/lib/error-compat";
import { evidenceErrors } from "@/lib/evidence-errors";
import { AppError } from "@/shared/kernel/errors";
import type { Prisma } from "@prisma/client";

export type EvidenceAttributionErrorCode =
  | "RELATIONSHIP_NOT_FOUND"
  | "ATTRIBUTION_CONFLICT";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const EvidenceAttributionError = appErrorConstructor(
  (
    message: string,
    code: EvidenceAttributionErrorCode,
    field: "taskId" | "projectId",
    status: 404 | 409
  ) => new AppError({ status, message, code, field })
);
export type EvidenceAttributionError = AppError;

type EvidenceAttributionClient = Pick<
  Prisma.TransactionClient,
  "task" | "project"
>;

export async function resolveTaskProjectAttribution(
  taskValue: unknown,
  projectValue: unknown,
  database: EvidenceAttributionClient
) {
  const taskId = String(taskValue ?? "").trim() || null;
  let projectId = String(projectValue ?? "").trim() || null;
  let attributedProjectId = projectId;

  if (taskId) {
    const task = await database.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true }
    });
    if (!task) {
      throw new AppError(evidenceErrors.theLinkedTaskCouldNotBeFound);
    }
    if (task.projectId) {
      if (projectId && projectId !== task.projectId) {
        throw new AppError(evidenceErrors.theSelectedTaskBelongsToADifferentProject);
      }
      projectId = null;
      attributedProjectId = task.projectId;
    }
  }

  if (projectId) {
    const project = await database.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });
    if (!project) {
      throw new AppError(evidenceErrors.theLinkedProjectCouldNotBeFound);
    }
  }

  return { taskId, projectId, attributedProjectId };
}
