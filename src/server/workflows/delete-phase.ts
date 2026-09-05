import { prisma } from "@/lib/prisma";
import { deletePhaseRecord, translateProjectPersistenceError } from "@/modules/projects/services/projects";
import { detachPhaseTasks } from "@/modules/planning/services/tasks";

export async function deletePhase(id: string) {
  try {
    await prisma.$transaction(async tx => {
      await detachPhaseTasks(tx, id);
      await deletePhaseRecord(tx, id);
    });
  } catch (error) { throw translateProjectPersistenceError(error, "phase-delete"); }
}
