import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, startOfLocalDay } from "@/lib/dates";

export async function GET() {
  const today = startOfLocalDay();
  const horizon = addDays(today, 14);

  const [tasks, notes, diaryEntries, materials, timeBlocks] = await Promise.all([
    prisma.task.findMany({
      where: { date: { gte: today, lt: horizon } },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }]
    }),
    prisma.note.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.diaryEntry.findMany({ orderBy: { date: "desc" }, take: 30 }),
    prisma.material.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.timeBlock.findMany({ where: { date: { gte: today, lt: horizon } }, orderBy: { date: "asc" } })
  ]);

  return NextResponse.json({
    app: "Dayflow",
    exportedAt: new Date().toISOString(),
    purpose: "Local-first productivity data for a future external agent integration.",
    schemaVersion: 1,
    tasks,
    notes: notes.map((note) => ({ ...note, tags: parseTags(note.tags) })),
    diaryEntries,
    materials,
    timeBlocks
  });
}

function parseTags(tags: string) {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}
