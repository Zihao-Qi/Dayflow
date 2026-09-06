import { prisma } from "@/lib/prisma";
import { projectErrors } from "@/modules/projects/domain/project";
import { deleteProjectRecord, projectExists, translateProjectPersistenceError } from "@/modules/projects/services/projects";
import { detachProjectTasks } from "@/modules/planning/services/tasks";
import { AppError } from "@/shared/kernel/errors";

export async function deleteProject(id: string) {
  try {
    await prisma.$transaction(async tx => {
      if (!await projectExists(tx, id)) throw new AppError(projectErrors.projectNotFound);
      await detachProjectTasks(tx, id);
      // Evidence and journal have no services yet. Keep these narrow detaches in
      // the cross-module workflow; later slices can move them without changing this root.
      // Preserve the legacy OR rule: either link matching clears BOTH project links.
      await tx.activityEntry.updateMany({
        where: { OR: [{ projectId: id }, { attributedProjectId: id }] },
        data: { projectId: null, attributedProjectId: null }
      });
      await tx.note.updateMany({ where: { projectId: id }, data: { projectId: null } });
      await tx.material.updateMany({ where: { projectId: id }, data: { projectId: null } });
      await deleteProjectRecord(tx, id);
    });
  } catch (error) { throw translateProjectPersistenceError(error, "delete"); }
}
