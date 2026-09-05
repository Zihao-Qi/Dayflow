import type { Prisma } from "@prisma/client";
import type { DiaryUpsertMutation } from "../domain/diary";

export function upsertDiary(tx: Prisma.TransactionClient, input: DiaryUpsertMutation) {
  return tx.diaryEntry.upsert({
    where: { date: input.date }, create: input,
    update: { content: input.content, reflection: input.reflection, mood: input.mood, energy: input.energy }
  });
}

export function readDiary(database: { diaryEntry: Pick<Prisma.TransactionClient["diaryEntry"], "findUnique"> }, date: Date) {
  return database.diaryEntry.findUnique({ where: { date } });
}

export function readReviewDiaries(database: { diaryEntry: Pick<Prisma.TransactionClient["diaryEntry"], "findMany"> }, range: { start: Date; end: Date }) {
  return database.diaryEntry.findMany({ where: { date: { gte: range.start, lt: range.end } }, orderBy: { date: "asc" } });
}
