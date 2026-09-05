import { detachProjectNotes } from "@/modules/journal/services/notes";
import { detachProjectMaterials } from "@/modules/journal/services/materials";
import { getPrisma } from "@/lib/prisma";
import { projectErrors } from "@/modules/projects/domain/project";
import { deleteProjectRecord, projectExists, translateProjectPersistenceError } from "@/modules/projects/services/projects";
import { detachProjectTasks } from "@/modules/planning/services/tasks";
import { AppError } from "@/shared/kernel/errors";

export async function deleteProject(id: string) {
  try {
    await getPrisma().$transaction(async tx => {
      if (!await projectExists(tx, id)) throw new AppError(projectErrors.projectNotFound);
      await detachProjectTasks(tx, id);
      // The evidence detach remains owned by this cross-module workflow.
      // Preserve the legacy OR rule: either link matching clears BOTH project links.
      await tx.activityEntry.updateMany({
        where: { OR: [{ projectId: id }, { attributedProjectId: id }] },
        data: { projectId: null, attributedProjectId: null }
      });
      await detachProjectNotes(tx, id);
      await detachProjectMaterials(tx, id);
      await deleteProjectRecord(tx, id);
    });
  } catch (error) { throw translateProjectPersistenceError(error, "delete"); }
}
