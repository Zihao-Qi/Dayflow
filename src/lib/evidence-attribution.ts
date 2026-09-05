import type { Prisma } from "@prisma/client";

export type EvidenceAttributionErrorCode =
  | "RELATIONSHIP_NOT_FOUND"
  | "ATTRIBUTION_CONFLICT";

export class EvidenceAttributionError extends Error {
  constructor(
    message: string,
    readonly code: EvidenceAttributionErrorCode,
    readonly field: "taskId" | "projectId",
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = "EvidenceAttributionError";
  }
}

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
      throw new EvidenceAttributionError(
        "The linked task could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        "taskId",
        404
      );
    }
    if (task.projectId) {
      if (projectId && projectId !== task.projectId) {
        throw new EvidenceAttributionError(
          "The selected task belongs to a different project.",
          "ATTRIBUTION_CONFLICT",
          "projectId",
          409
        );
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
      throw new EvidenceAttributionError(
        "The linked project could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        "projectId",
        404
      );
    }
  }

  return { taskId, projectId, attributedProjectId };
}
