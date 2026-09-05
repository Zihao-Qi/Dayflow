import type { Prisma } from "@prisma/client";
import { readTaskAttribution } from "@/modules/planning/services/tasks";
import { projectExists } from "@/modules/projects/services/projects";
import { AppError } from "@/shared/kernel/errors";
import { evidenceErrors, isFocusActivityProtected, normalizeEvidenceRelationshipIds, resolveTaskProjectAttribution, type ActivityCreateMutation, type ActivityReplaceMutation } from "../domain/activity";

type AttributionDatabase = {
  task: Pick<Prisma.TransactionClient["task"], "findUnique">;
  project: Pick<Prisma.TransactionClient["project"], "findUnique">;
};

export async function readActivityAttribution(database: AttributionDatabase, taskValue: unknown, projectValue: unknown) {
  const { taskId, projectId } = normalizeEvidenceRelationshipIds(taskValue, projectValue);
  const task = taskId ? await readTaskAttribution(database, taskId) : null;
  // Preserve read/error order: task-derived attribution needs no direct Project read.
  const project = projectId && (!taskId || (task && !task.projectId))
    ? await projectExists(database, projectId) : null;
  return resolveTaskProjectAttribution(taskId, projectId, { task, project });
}

export async function createActivity(tx: Prisma.TransactionClient, input: ActivityCreateMutation) {
  try {
    const attribution = await readActivityAttribution(tx, input.taskId, input.projectId);
    // Explicit fields keep caller-supplied origin/session fields out of manual evidence.
    return await tx.activityEntry.create({ data: {
      startedAt: input.startedAt, durationMinutes: input.durationMinutes,
      category: input.category, note: input.note,
      taskId: attribution.taskId, projectId: attribution.projectId,
      attributedProjectId: attribution.attributedProjectId
    } });
  } catch (error) { throw translateActivityPersistenceError(error, "create"); }
}

export async function replaceActivity(
  transaction: Prisma.TransactionClient,
  id: string,
  input: ActivityReplaceMutation
) {
  try {
    const existing = await transaction.activityEntry.findUnique({
      where: { id },
      select: {
        id: true,
        startedAt: true,
        origin: true,
        taskId: true,
        projectId: true,
        attributedProjectId: true,
        focusSessionId: true,
        updatedAt: true
      }
    });
    if (!existing) {
      throw new AppError(evidenceErrors.activityNotFound);
    }
    if (isFocusActivityProtected(existing)) {
      throw new AppError(evidenceErrors.focusEvidenceCannotBeEditedHere);
    }

    const relationshipsChanged =
      input.taskId !== existing.taskId ||
      input.projectId !== existing.projectId;
    const attribution = relationshipsChanged
      ? await readActivityAttribution(transaction, input.taskId, input.projectId)
      : {
        taskId: existing.taskId,
        projectId: existing.projectId,
        attributedProjectId: existing.attributedProjectId
      };
    const startedAt = applyTimeToLocalDate(
      existing.startedAt,
      input.startTime
    );
    const updated = await transaction.activityEntry.updateMany({
      where: {
        id,
        origin: "MANUAL",
        focusSessionId: null,
        updatedAt: existing.updatedAt
      },
      data: {
        startedAt,
        durationMinutes: input.durationMinutes,
        category: input.category,
        note: input.note,
        taskId: attribution.taskId,
        projectId: attribution.projectId,
        attributedProjectId: attribution.attributedProjectId
      }
    });
    if (updated.count !== 1) {
      throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeUpdated);
    }
    const activity = await transaction.activityEntry.findUnique({
      where: { id }
    });
    if (!activity) {
      throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeUpdated);
    }
    return activity;
  } catch (error) { throw translateActivityPersistenceError(error, "replace"); }
}

function applyTimeToLocalDate(date: Date, startTime: string) {
  const startedAt = new Date(date);
  startedAt.setHours(
    Number(startTime.slice(0, 2)),
    Number(startTime.slice(3, 5)),
    0,
    0
  );
  return startedAt;
}

export async function deleteActivity(tx: Prisma.TransactionClient, id: string) {
  try {
    const activity = await tx.activityEntry.findUnique({ where: { id }, select: { focusSessionId: true, origin: true } });
    if (!activity) throw new AppError(evidenceErrors.activityDeleteNotFound);
    if (isFocusActivityProtected(activity)) throw new AppError(evidenceErrors.focusEvidenceCannotBeDeleted);
    const deleted = await tx.activityEntry.deleteMany({ where: { id, focusSessionId: null, origin: "MANUAL" } });
    if (deleted.count !== 1) throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeDeleted);
    return { ok: true as const, id };
  } catch (error) { throw translateActivityPersistenceError(error, "delete"); }
}

export type ActivityMutationAction = "create" | "replace" | "delete";

/** Transaction roots reuse this for failures raised while committing. */
export function translateActivityPersistenceError(error: unknown, action: ActivityMutationAction): unknown {
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error &&
      (error.code === "P2003" || error.code === "P2025")) {
    return new AppError(action === "delete" ? evidenceErrors.theActivityChangedBeforeItCouldBeDeleted : evidenceErrors.theLinkedActivityRelationshipIsNoLongerAvailable, error);
  }
  // P2002 must reach runOnce; unknown errors keep the operation's fallback.
  return error;
}

type ActivityReadDatabase = { activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "findMany"> };
type DateRange = { start: Date; end: Date };

export function readDayActivities(database: ActivityReadDatabase, range: DateRange) {
  return database.activityEntry.findMany({ where: { startedAt: { gte: range.start, lt: range.end } }, orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }] });
}

export function readActivityCategories(database: ActivityReadDatabase) {
  return database.activityEntry.findMany({ select: { category: true }, distinct: ["category"] });
}

export function readReviewActivities(database: ActivityReadDatabase, range: DateRange) {
  return database.activityEntry.findMany({ where: { startedAt: { gte: range.start, lt: range.end } }, orderBy: { startedAt: "asc" }, include: { focusSession: { select: { needsEnrichment: true } } } });
}

export function readEarliestActivity(database: { activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "findFirst"> }) {
  return database.activityEntry.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } });
}

export function readProjectActivitySummaries(database: ActivityReadDatabase, projectIds: string[]) {
  return database.activityEntry.findMany({ where: { attributedProjectId: { in: projectIds } }, select: { id: true, attributedProjectId: true, durationMinutes: true, startedAt: true } });
}

export function readProjectActivities(database: ActivityReadDatabase, projectId: string) {
  return database.activityEntry.findMany({ where: { attributedProjectId: projectId }, orderBy: { startedAt: "desc" } });
}
