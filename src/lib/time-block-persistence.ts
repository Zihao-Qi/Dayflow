import { localDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { timeBlockErrors, timeBlockOverlapError } from "@/lib/time-block-errors";
import {
  assertTimeBlockIsNotPast,
  isTimeBlockRecord,
  timeBlockIntervalsOverlap,
  type TimeBlockDraft
} from "@/lib/time-blocks";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";

type TimeBlockDatabase = Prisma.TransactionClient | typeof prisma;
const timeBlockTaskSelection = {
  id: true,
  title: true,
  estimateMinutes: true
} as const;

type PersistedTimeBlock = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  title: string;
  taskId: string | null;
  createdAt: Date;
  task: {
    id: string;
    title: string;
    estimateMinutes: number;
  } | null;
};

export async function createTimeBlock(
  input: TimeBlockDraft,
  transaction: Prisma.TransactionClient
) {
  await validatePersistedTimeBlock(input, transaction);
  const timeBlock = await transaction.timeBlock.create({
    data: input,
    include: { task: { select: timeBlockTaskSelection } }
  });
  return serializeTimeBlock(timeBlock);
}

export async function replaceTimeBlock(
  id: string,
  input: TimeBlockDraft,
  now: Date
) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.timeBlock.findUnique({
      where: { id },
      select: { id: true, date: true, taskId: true }
    });
    if (!current) {
      throw new AppError(timeBlockErrors.timeBlockNotFound);
    }
    if (input.date.getTime() !== current.date.getTime()) {
      assertTimeBlockIsNotPast(input, now);
    }
    await validatePersistedTimeBlock(
      input,
      transaction,
      id,
      current.taskId
    );
    const timeBlock = await transaction.timeBlock.update({
      where: { id },
      data: input,
      include: { task: { select: timeBlockTaskSelection } }
    });
    return serializeTimeBlock(timeBlock);
  });
}

export async function deleteTimeBlock(id: string) {
  await prisma.timeBlock.delete({ where: { id } });
  return { ok: true as const, id };
}

export function serializeTimeBlock(timeBlock: PersistedTimeBlock) {
  return {
    id: timeBlock.id,
    date: localDateKey(timeBlock.date),
    startTime: timeBlock.startTime,
    endTime: timeBlock.endTime,
    title: timeBlock.title,
    taskId: timeBlock.taskId,
    createdAt: timeBlock.createdAt.toISOString(),
    task: timeBlock.task
  };
}

async function validatePersistedTimeBlock(
  input: TimeBlockDraft,
  database: TimeBlockDatabase,
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
    const retainsExistingLink = input.taskId === retainedTaskId;
    if (
      !retainsExistingLink &&
      (task.status === "DONE" ||
        task.date?.getTime() !== input.date.getTime())
    ) {
      throw new AppError(timeBlockErrors.chooseAnUnfinishedTaskScheduledForTheSameDayAsThe);
    }
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
