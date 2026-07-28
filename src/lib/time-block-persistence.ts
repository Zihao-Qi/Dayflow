import { Prisma } from "@prisma/client";
import { localDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import {
  isTimeBlockRecord,
  TimeBlockError,
  timeBlockIntervalsOverlap,
  type TimeBlockDraft
} from "@/lib/time-blocks";

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
  input: TimeBlockDraft
) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.timeBlock.findUnique({
      where: { id },
      select: { id: true, taskId: true }
    });
    if (!current) {
      throw new TimeBlockError(
        "Time Block not found.",
        "NOT_FOUND",
        404,
        "id"
      );
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
      throw new TimeBlockError(
        "The selected Task could not be found.",
        "RELATIONSHIP_NOT_FOUND",
        404,
        "taskId"
      );
    }
    const retainsExistingLink = input.taskId === retainedTaskId;
    if (
      !retainsExistingLink &&
      (task.status === "DONE" ||
        task.date?.getTime() !== input.date.getTime())
    ) {
      throw new TimeBlockError(
        "Choose an unfinished Task scheduled for the same day as the Time Block.",
        "RELATIONSHIP_CONFLICT",
        409,
        "taskId"
      );
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
    throw new TimeBlockError(
      `This Time Block overlaps "${overlap.title}" at ${overlap.startTime}–${overlap.endTime}.`,
      "TIME_BLOCK_OVERLAP",
      409,
      "startTime"
    );
  }
}
