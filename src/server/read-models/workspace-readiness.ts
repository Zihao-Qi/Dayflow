import type { Prisma, PrismaClient } from "@prisma/client";

export async function isWorkspaceEmpty(database: PrismaClient | Prisma.TransactionClient) {
  const records = "$transaction" in database ? await database.$transaction(
    workspaceRecordQueries(database)
  ) : await Promise.all(workspaceRecordQueries(database));

  return records.every((record) => record === null);
}

// Reuse an existing transaction, while preserving the standalone batch read.
function workspaceRecordQueries(database: Prisma.TransactionClient) {
  return [
    database.project.findFirst({ select: { id: true } }),
    database.task.findFirst({ select: { id: true } }),
    database.note.findFirst({ select: { id: true } }),
    database.diaryEntry.findFirst({ select: { id: true } }),
    database.review.findFirst({ select: { id: true } }),
    database.material.findFirst({ select: { id: true } }),
    database.timeBlock.findFirst({ select: { id: true } }),
    database.activityEntry.findFirst({ select: { id: true } }),
    database.focusSession.findFirst({ select: { id: true } })
  ];
}
