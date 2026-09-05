import type { Prisma } from "@prisma/client";
import { validateProjectPlacement } from "@/modules/projects/services/projects";
import { AppError } from "@/shared/kernel/errors";
import type { Calendar } from "@/shared/kernel/calendar";
import {
  planTaskPatch,
  serializeTask,
  taskErrors,
  type TaskCreateMutation,
  type TaskPatchInput
} from "../domain/task";
import { compactFocusQueue, consumeFocusQueueTask } from "./focus-queue";

export async function createTask(tx: Prisma.TransactionClient, input: TaskCreateMutation) {
  try {
    await validateProjectPlacement(tx, input.projectId, input.phaseId, { allowCompleted: input.status === "DONE" });
    const maxTask = await tx.task.findFirst({ where: { date: input.date }, orderBy: { sortOrder: "desc" } });
    return serializeTask(await tx.task.create({ data: { ...input, sortOrder: (maxTask?.sortOrder ?? 0) + 1 } }));
  } catch (error) {
    throw translateTaskPersistenceError(error, "create");
  }
}

export async function updateTask(
  tx: Prisma.TransactionClient,
  id: string,
  patch: TaskPatchInput,
  calendar: Calendar,
  now: Date
) {
  try {
    const current = await tx.task.findUnique({
      where: { id }, select: { date: true, projectId: true, phaseId: true, status: true }
    });
    if (!current) throw new AppError(taskErrors.taskNotFound);
    const plan = planTaskPatch(current, patch, calendar, now);
    await validateProjectPlacement(tx, plan.projectId, plan.phaseId, { allowCompleted: plan.status === "DONE" });
    await tx.task.update({ where: { id }, data: plan.data });
    if (plan.consumeQueue) await consumeFocusQueueTask(tx, id);
    if (plan.scheduleChange) {
      await tx.taskScheduleChange.create({ data: { taskId: id, ...plan.scheduleChange } });
    }
    return serializeTask(await tx.task.findUniqueOrThrow({ where: { id } }));
  } catch (error) {
    throw translateTaskPersistenceError(error, "save");
  }
}

export async function deleteTask(tx: Prisma.TransactionClient, id: string) {
  try {
    await tx.task.delete({ where: { id } });
    await compactFocusQueue(tx);
    return { ok: true as const };
  } catch (error) {
    throw translateTaskPersistenceError(error, "delete");
  }
}

export async function reorderTasks(tx: Prisma.TransactionClient, ids: string[]) {
  try {
    const current = await tx.task.findMany({ where: { id: { in: ids } } });
    if (current.length !== ids.length) throw new AppError(taskErrors.oneOrMoreTasksCouldNotBeFound);
    for (const [index, id] of ids.entries()) {
      await tx.task.update({ where: { id }, data: { sortOrder: index + 1 } });
    }
    const persisted = await tx.task.findMany({ where: { id: { in: ids } } });
    const byId = new Map(persisted.map((task) => [task.id, task]));
    return ids.map((id) => serializeTask(byId.get(id)!));
  } catch (error) {
    throw translateTaskPersistenceError(error, "reorder");
  }
}

export async function undoSchedule(tx: Prisma.TransactionClient, id: string) {
  try {
    const taskExists = await tx.task.findUnique({ where: { id }, select: { id: true } });
    if (!taskExists) throw new AppError(taskErrors.taskNotFoundidNOTFOUND);
    const latest = await tx.taskScheduleChange.findFirst({
      where: { taskId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!latest) throw new AppError(taskErrors.thereIsNoScheduleChangeToUndo);
    const claimed = await tx.taskScheduleChange.deleteMany({ where: { id: latest.id, taskId: id } });
    if (claimed.count !== 1) throw new AppError(taskErrors.theScheduleChangedBeforeItCouldBeUndone);
    return serializeTask(await tx.task.update({ where: { id }, data: { date: latest.previousDate } }));
  } catch (error) {
    throw translateTaskPersistenceError(error, "undo");
  }
}

type TaskReadDatabase = { task: Pick<Prisma.TransactionClient["task"], "findUnique"> };

export async function readTask(database: TaskReadDatabase, id: string) {
  const task = await database.task.findUnique({ where: { id } });
  return task ? serializeTask(task) : null;
}

export async function readDayTasks(database: { task: Pick<Prisma.TransactionClient["task"], "findMany"> }, range: { start: Date; end: Date }) {
  const tasks = await database.task.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return tasks.map(serializeTask);
}

type TaskListReadDatabase = { task: Pick<Prisma.TransactionClient["task"], "findMany"> };

/** Scheduled window plus overdue, backlog and queued Tasks, retaining raw records. */
export function readTaskWindow(tx: TaskListReadDatabase, range: { start: Date; end: Date }, today: Date) {
  return tx.task.findMany({
    where: {
      OR: [
        { date: { gte: range.start, lt: range.end } },
        { date: { lt: today }, status: { not: "DONE" } },
        { date: null },
        { focusQueuePosition: { not: null } }
      ]
    },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

export function readOpenTaskPalette(tx: TaskListReadDatabase) {
  return tx.task.findMany({
    where: { status: { not: "DONE" } },
    select: {
      id: true,
      title: true,
      date: true,
      estimateMinutes: true,
      sortOrder: true,
      focusQueuePosition: true,
      projectId: true
    }
  });
}

/** All statuses within the exact half-open scheduled-date range. */
export function readTasksInDateRange(tx: TaskListReadDatabase, range: { start: Date; end: Date }) {
  return tx.task.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    orderBy: { date: "asc" }
  });
}

export type TaskMutationAction = "create" | "save" | "delete" | "reorder" | "undo";

/** Also used by server transaction roots for failures raised while committing. */
export function translateTaskPersistenceError(error: unknown, action: TaskMutationAction): unknown {
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error) {
    if (action === "create" && error.code === "P2003") {
      return new AppError(taskErrors.theSelectedTaskRelationshipIsNoLongerAvailable, error);
    }
    if (action === "save" || action === "delete") {
      if (error.code === "P2025") return new AppError(taskErrors.taskNotFound, error);
      if (error.code === "P2003") return new AppError(taskErrors.aRelatedRecordChangedBeforeTheTaskCouldBeSaved, error);
    }
    if (action === "reorder" && error.code === "P2025") {
      return new AppError(taskErrors.aTaskChangedBeforeItsOrderCouldBeSaved, error);
    }
    if (action === "undo" && (error.code === "P2003" || error.code === "P2025")) {
      return new AppError(taskErrors.theScheduleChangedBeforeItCouldBeUndone, error);
    }
  }
  // P2002 must reach runOnce for receipt-race recovery. Queue errors retain their fallback.
  return error;
}

/** Project workflows pass their transaction through these planning capabilities. */
export function countUnfinishedProjectTasks(database: { task: Pick<Prisma.TransactionClient["task"], "count"> }, projectId: string) {
  return database.task.count({ where: { projectId, status: { not: "DONE" } } });
}

export function readProjectTasks(database: { task: Pick<Prisma.TransactionClient["task"], "findMany"> }, projectIds: string[]) {
  return database.task.findMany({ where: { projectId: { in: projectIds } }, orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function detachProjectTasks(tx: Prisma.TransactionClient, projectId: string) {
  await tx.task.updateMany({ where: { projectId }, data: { projectId: null, phaseId: null } });
}

export async function detachPhaseTasks(tx: Prisma.TransactionClient, phaseId: string) {
  await tx.task.updateMany({ where: { phaseId }, data: { phaseId: null } });
}

/** Narrow relationship snapshot for evidence attribution. */
export function readTaskAttribution(database: TaskReadDatabase, id: string) {
  return database.task.findUnique({ where: { id }, select: { id: true, projectId: true } });
}

/** Review counts completions using the evidence period's exact half-open bounds. */
export function readReviewCompletedTasks(database: { task: Pick<Prisma.TransactionClient["task"], "findMany"> }, range: { start: Date; end: Date }) {
  return database.task.findMany({ where: { completedAt: { gte: range.start, lt: range.end } }, select: { id: true } });
}

/** Focus snapshots only the Task identity, title and current Project attribution. */
export function readFocusTask(database: TaskReadDatabase, id: string) {
  return database.task.findUnique({ where: { id }, select: { id: true, title: true, projectId: true } });
}

/** Explicit completion handoff; preserve an already completed Task's timestamp. */
export function completeFocusTask(tx: Prisma.TransactionClient, id: string, now: Date) {
  return tx.task.updateMany({ where: { id, status: { not: "DONE" } }, data: { status: "DONE", completedAt: now } });
}
