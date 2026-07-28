import { prisma } from "@/lib/prisma";

export class EvidenceAttributionError extends Error {}

export async function resolveTaskProjectAttribution(
  taskValue: unknown,
  projectValue: unknown
) {
  const taskId = String(taskValue ?? "").trim() || null;
  let projectId = String(projectValue ?? "").trim() || null;
  let attributedProjectId = projectId;

  if (taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true }
    });
    if (!task) {
      throw new EvidenceAttributionError("The linked task could not be found.");
    }
    if (task.projectId) {
      if (projectId && projectId !== task.projectId) {
        throw new EvidenceAttributionError(
          "The selected task belongs to a different project."
        );
      }
      projectId = null;
      attributedProjectId = task.projectId;
    }
  }

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });
    if (!project) {
      throw new EvidenceAttributionError(
        "The linked project could not be found."
      );
    }
  }

  return { taskId, projectId, attributedProjectId };
}
