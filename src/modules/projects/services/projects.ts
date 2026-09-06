import type { Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { projectErrors, type ProjectCreateMutation, type ProjectPatchMutation, type PhaseCreateMutation, type PhasePatchMutation } from "../domain/project";

export async function createProject(tx: Prisma.TransactionClient, input: ProjectCreateMutation) {
  try { return await tx.project.create({ data: input }); }
  catch (error) { throw translateProjectPersistenceError(error, "create"); }
}

/** Completion policy belongs to the server workflow, which can read planning. */
export async function updateProject(tx: Prisma.TransactionClient, id: string, data: ProjectPatchMutation["data"]) {
  try { return await tx.project.update({ where: { id }, data }); }
  catch (error) { throw translateProjectPersistenceError(error, "save"); }
}

export async function createPhase(tx: Prisma.TransactionClient, projectId: string, input: PhaseCreateMutation) {
  try {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (!project) throw new AppError(projectErrors.phaseParentNotFound);
    if (project.status === "COMPLETED") throw new AppError(projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork);
    const lastPhase = await tx.projectPhase.findFirst({ where: { projectId }, orderBy: { sortOrder: "desc" } });
    return await tx.projectPhase.create({ data: { projectId, name: input.name, sortOrder: (lastPhase?.sortOrder ?? 0) + 1 } });
  } catch (error) { throw translateProjectPersistenceError(error, "phase-create"); }
}

export async function updatePhase(tx: Prisma.TransactionClient, id: string, data: PhasePatchMutation) {
  try { return await tx.projectPhase.update({ where: { id }, data }); }
  catch (error) { throw translateProjectPersistenceError(error, "phase-save"); }
}

export async function deleteProjectRecord(tx: Prisma.TransactionClient, id: string) {
  try { await tx.project.delete({ where: { id } }); }
  catch (error) { throw translateProjectPersistenceError(error, "delete"); }
}

export async function deletePhaseRecord(tx: Prisma.TransactionClient, id: string) {
  try { await tx.projectPhase.delete({ where: { id } }); }
  catch (error) { throw translateProjectPersistenceError(error, "phase-delete"); }
}

type ProjectPlacementDatabase = {
  project: Pick<Prisma.TransactionClient["project"], "findUnique">;
  projectPhase: Pick<Prisma.TransactionClient["projectPhase"], "findUnique">;
};

export async function validateProjectPlacement(
  client: ProjectPlacementDatabase,
  projectId: string | null,
  phaseId: string | null,
  options: { allowCompleted?: boolean } = {}
) {
  if (!projectId && phaseId) {
    throw new AppError(projectErrors.aTaskCannotHaveAPhaseWithoutAProject);
  }

  if (!projectId) return;

  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true }
  });
  if (!project) throw new AppError(projectErrors.theSelectedProjectCouldNotBeFound);
  if (project.status === "COMPLETED" && !options.allowCompleted) {
    throw new AppError(projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork);
  }

  if (!phaseId) return;

  const phase = await client.projectPhase.findUnique({
    where: { id: phaseId },
    select: { projectId: true }
  });
  if (!phase) {
    throw new AppError(projectErrors.theSelectedPhaseCouldNotBeFound);
  }
  if (phase.projectId !== projectId) {
    throw new AppError(projectErrors.theSelectedPhaseDoesNotBelongToThisProject);
  }
}

const phases = { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } as const;

export function readProject(database: { project: Pick<Prisma.TransactionClient["project"], "findUnique"> }, id: string) {
  return database.project.findUnique({ where: { id }, include: { phases: { orderBy: [...phases.orderBy] } } });
}

export function readProjectName(database: { project: Pick<Prisma.TransactionClient["project"], "findUnique"> }, id: string) {
  return database.project.findUnique({ where: { id }, select: { name: true } });
}

export function projectExists(database: { project: Pick<Prisma.TransactionClient["project"], "findUnique"> }, id: string) {
  return database.project.findUnique({ where: { id }, select: { id: true } });
}

export function readProjects(database: { project: Pick<Prisma.TransactionClient["project"], "findMany"> }) {
  return database.project.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { phases: { select: { id: true } } } });
}

export type ProjectMutationAction = "create" | "save" | "delete" | "phase-create" | "phase-save" | "phase-delete";

/** Transaction roots also use this for errors raised at commit. P2002 reaches runOnce. */
export function translateProjectPersistenceError(error: unknown, action: ProjectMutationAction): unknown {
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error) {
    if (action === "create" && error.code === "P2003") return new AppError(projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeCreated, error);
    if (action === "save" || action === "delete") {
      if (error.code === "P2025") return new AppError(projectErrors.projectNotFound, error);
      if (error.code === "P2003") return new AppError(projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeSaved, error);
    }
    if (action === "phase-create" && error.code === "P2003") return new AppError(projectErrors.theSelectedProjectIsNoLongerAvailable, error);
    if ((action === "phase-save" || action === "phase-delete") && error.code === "P2025") return new AppError(projectErrors.phaseNotFound, error);
  }
  return error;
}
