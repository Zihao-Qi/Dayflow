import type { Material, Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { journalErrors, type MaterialCreateInput } from "../domain/journal";
import { readCollectionHistory, type JournalHistoryCriteria } from "./history";
import { resolveMaterialRelations } from "./relations";

export async function createMaterial(tx: Prisma.TransactionClient, input: MaterialCreateInput) {
  try {
    const relations = await resolveMaterialRelations(tx, input);
    return await tx.material.create({ data: {
      title: input.title, url: input.url, type: input.type, notes: input.notes,
      taskId: relations.taskId, noteId: relations.noteId, projectId: relations.projectId
    } });
  } catch (error) { throw translateMaterialPersistenceError(error, "create"); }
}

export async function readMaterialHistory(tx: Prisma.TransactionClient, criteria: JournalHistoryCriteria) {
  try {
    return await readCollectionHistory<Material>(tx, "material", criteria);
  } catch (error) { throw translateMaterialPersistenceError(error, "read"); }
}

/** Journal storage failures retain the route's internal-error envelope. */
export function translateMaterialPersistenceError(error: unknown, operation: "create" | "read"): unknown {
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error &&
      (error.code === "P2003" || error.code === "P2025")) {
    return new AppError(operation === "create" ? journalErrors.theReferenceCouldNotBeSaved : journalErrors.referencesCouldNotBeLoaded, error);
  }
  // P2002 remains available to runOnce's receipt-race handling.
  return error;
}

/** The project-deletion workflow owns detach error translation. */
export async function detachProjectMaterials(tx: Prisma.TransactionClient, projectId: string) {
  await tx.material.updateMany({ where: { projectId }, data: { projectId: null } });
}

type MaterialReadDatabase = { material: Pick<Prisma.TransactionClient["material"], "findMany"> };
type DateRange = { start: Date; end: Date };

export function readRecentMaterials(database: MaterialReadDatabase) {
  return database.material.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
}

export function readProjectMaterials(database: MaterialReadDatabase, projectId: string, taskIds: string[]) {
  return database.material.findMany({ where: { OR: [{ projectId }, { taskId: { in: taskIds } }] }, orderBy: { createdAt: "desc" } });
}

export function readReviewMaterials(database: MaterialReadDatabase, range: DateRange) {
  return database.material.findMany({ where: { createdAt: { gte: range.start, lt: range.end } }, select: { id: true } });
}
