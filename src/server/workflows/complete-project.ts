import { getPrisma } from "@/lib/prisma";
import type { ProjectPatchMutation } from "@/modules/projects/domain/project";
import { projectExists, updateProject, translateProjectPersistenceError } from "@/modules/projects/services/projects";
import { countUnfinishedProjectTasks } from "@/modules/planning/services/tasks";
import { getProjectDetail } from "@/server/read-models/project-detail";

/** All project patches use this root so completion and the other edits are atomic. */
export async function completeProject(id: string, input: ProjectPatchMutation, reviewPeriod: { start: Date; end: Date }) {
  try {
    return await getPrisma().$transaction(async tx => {
      if (!await projectExists(tx, id)) return { kind: "not-found" as const };
      if (input.data.status === "COMPLETED" && !input.confirmCompletion && await countUnfinishedProjectTasks(tx, id)) {
        return { kind: "confirmation-required" as const };
      }
      await updateProject(tx, id, input.data);
      const detail = await getProjectDetail(tx, id, reviewPeriod);
      return detail ? { kind: "saved" as const, detail } : { kind: "not-found" as const };
    });
  } catch (error) { throw translateProjectPersistenceError(error, "save"); }
}
