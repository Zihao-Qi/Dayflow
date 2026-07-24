import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, startOfLocalDay } from "@/lib/dates";

export async function GET() {
  const today = startOfLocalDay();
  const horizon = addDays(today, 14);

  const [
    projects,
    phases,
    focusSessions,
    tasks,
    scheduleChanges,
    notes,
    diaryEntries,
    materials,
    timeBlocks,
    activities
  ] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.projectPhase.findMany({ orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }] }),
    prisma.focusSession.findMany({ orderBy: { startedAt: "desc" }, take: 250 }),
    prisma.task.findMany({
      where: {
        OR: [
          { date: { gte: today, lt: horizon } },
          { date: null },
          { projectId: { not: null } }
        ]
      },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }]
    }),
    prisma.taskScheduleChange.findMany({ orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.note.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.diaryEntry.findMany({ orderBy: { date: "desc" }, take: 30 }),
    prisma.material.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.timeBlock.findMany({ where: { date: { gte: today, lt: horizon } }, orderBy: { date: "asc" } }),
    prisma.activityEntry.findMany({
      where: { startedAt: { gte: today, lt: horizon } },
      orderBy: { startedAt: "asc" }
    })
  ]);

  return NextResponse.json({
    app: "Dayflow",
    exportedAt: new Date().toISOString(),
    purpose: "Local-first productivity data for a future external agent integration.",
    schemaVersion: 5,
    projects,
    phases,
    focusSessions,
    tasks,
    scheduleChanges,
    notes: notes.map((note) => ({ ...note, tags: parseTags(note.tags) })),
    diaryEntries,
    materials,
    timeBlocks,
    activities
  });
}

function parseTags(tags: string) {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}
