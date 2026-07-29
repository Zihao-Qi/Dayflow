import type { PrismaClient } from "@prisma/client";

export async function isWorkspaceEmpty(database: PrismaClient) {
  const records = await database.$transaction([
    database.project.findFirst({ select: { id: true } }),
    database.task.findFirst({ select: { id: true } }),
    database.note.findFirst({ select: { id: true } }),
    database.diaryEntry.findFirst({ select: { id: true } }),
    database.review.findFirst({ select: { id: true } }),
    database.material.findFirst({ select: { id: true } }),
    database.timeBlock.findFirst({ select: { id: true } }),
    database.activityEntry.findFirst({ select: { id: true } }),
    database.focusSession.findFirst({ select: { id: true } })
  ]);

  return records.every((record) => record === null);
}
