import type { Prisma } from "@prisma/client";
import {
  assertTimeBlockIsNotPast,
  assertTimeBlockTaskRelationship,
  isTimeBlockRecord,
  serializeTimeBlock,
  timeBlockErrors,
  timeBlockIntervalsOverlap,
  timeBlockOverlapError,
  type TimeBlockDraft
} from "@/modules/planning/domain/time-block";
import { AppError } from "@/shared/kernel/errors";

const timeBlockTaskSelection = { id: true, title: true, estimateMinutes: true } as const;

export async function createTimeBlock(
  tx: Prisma.TransactionClient,
  input: TimeBlockDraft,
  now: Date
) {
  try {
    // Runs after receipt lookup, so a retry remains valid after midnight.
    assertTimeBlockIsNotPast(input, now);
    await validatePersistedTimeBlock(tx, input);
    const block = await tx.timeBlock.create({
      data: input,
      include: { task: { select: timeBlockTaskSelection } }
    });
    return serializeTimeBlock(block);
  } catch (error) {
    throw translateTimeBlockPersistenceError(error);
  }
}

export async function replaceTimeBlock(
  tx: Prisma.TransactionClient,
  id: string,
  input: TimeBlockDraft,
  now: Date
) {
  try {
    const current = await tx.timeBlock.findUnique({
      where: { id },
      select: { id: true, date: true, taskId: true }
    });
    if (!current) throw new AppError(timeBlockErrors.timeBlockNotFound);
    // An unchanged past date remains correctable.
    if (input.date.getTime() !== current.date.getTime()) {
      assertTimeBlockIsNotPast(input, now);
    }
    await validatePersistedTimeBlock(tx, input, id, current.taskId);
    const block = await tx.timeBlock.update({
      where: { id },
      data: input,
      include: { task: { select: timeBlockTaskSelection } }
    });
    return serializeTimeBlock(block);
  } catch (error) {
    throw translateTimeBlockPersistenceError(error);
  }
}

export async function deleteTimeBlock(tx: Prisma.TransactionClient, id: string) {
  try {
    await tx.timeBlock.delete({ where: { id } });
    return { ok: true as const, id };
  } catch (error) {
    throw translateTimeBlockPersistenceError(error);
  }
}

/** Also used at transaction roots for failures raised while committing. */
export function translateTimeBlockPersistenceError(error: unknown): unknown {
  // Prisma is type-only in services. Check the known-request-error shape instead
  // of importing its runtime constructor; plain objects with a code do not match.
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" &&
      "code" in error) {
    if (error.code === "P2025") return new AppError(timeBlockErrors.timeBlockNotFound, error);
    if (error.code === "P2003") return new AppError(timeBlockErrors.theSelectedTaskCouldNotBeFound, error);
  }
  // Preserve P2002 for runOnce's receipt-race recovery and all unknown failures.
  return error;
}

type TimeBlockReadDatabase = { timeBlock: Pick<Prisma.TransactionClient["timeBlock"], "findMany"> };

/** Keep day and multi-day ordering identical to the existing read contracts. */
export async function readTimeBlocks(
  database: TimeBlockReadDatabase,
  range: { start: Date; end: Date },
  scope: "day" | "range"
) {
  const blocks = await database.timeBlock.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    orderBy: [
      ...(scope === "range" ? [{ date: "asc" as const }] : []),
      { startTime: "asc" }, { endTime: "asc" }, { createdAt: "asc" }, { id: "asc" }
    ],
    include: { task: { select: timeBlockTaskSelection } }
  });
  return blocks.map(serializeTimeBlock).filter(isTimeBlockRecord);
}

async function validatePersistedTimeBlock(
  database: Pick<Prisma.TransactionClient, "task" | "timeBlock">,
  input: TimeBlockDraft,
  excludeId?: string,
  retainedTaskId: string | null = null
) {
  if (input.taskId) {
    const task = await database.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, status: true, date: true }
    });
    if (!task) {
      throw new AppError(timeBlockErrors.theSelectedTaskCouldNotBeFound);
    }
    assertTimeBlockTaskRelationship(input, task, retainedTaskId);
  }

  const candidates = await database.timeBlock.findMany({
    where: {
      date: input.date,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    orderBy: [
      { startTime: "asc" },
      { endTime: "asc" },
      { createdAt: "asc" },
      { id: "asc" }
    ],
    include: { task: { select: timeBlockTaskSelection } }
  });
  const overlap = candidates
    .map(serializeTimeBlock)
    .filter(isTimeBlockRecord)
    .find((candidate) => timeBlockIntervalsOverlap(input, candidate));
  if (overlap) {
    throw timeBlockOverlapError(overlap);
  }
}
