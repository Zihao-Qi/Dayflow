import type { Prisma, PrismaClient } from "@prisma/client";
import { withTransaction } from "@/server/prisma/client";

export async function isWorkspaceEmpty(database: PrismaClient | Prisma.TransactionClient) {
  const records = isRootClient(database) ? await withTransaction(
    database,
    (tx) => Promise.all(workspaceRecordQueries(tx))
  ) : await Promise.all(workspaceRecordQueries(database));

  return records.every((record) => record === null);
}

function isRootClient(database: PrismaClient | Prisma.TransactionClient): database is PrismaClient {
  // Prisma 7 exposes a callable $transaction on an existing transaction too.
  // $connect remains root-only; an existing transaction must be reused.
  return "$connect" in database && typeof database.$connect === "function";
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
