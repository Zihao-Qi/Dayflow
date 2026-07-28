import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [
    projects,
    phases,
    focusSessions,
    tasks,
    scheduleChanges,
    notes,
    diaryEntries,
    reviews,
    materials,
    timeBlocks,
    activities
  ] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.projectPhase.findMany({ orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }] }),
    prisma.focusSession.findMany({ orderBy: { startedAt: "desc" } }),
    prisma.task.findMany({ orderBy: [{ date: "asc" }, { sortOrder: "asc" }] }),
    prisma.taskScheduleChange.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.note.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.diaryEntry.findMany({ orderBy: { date: "desc" } }),
    prisma.review.findMany({ orderBy: { periodStart: "desc" } }),
    prisma.material.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.timeBlock.findMany({ orderBy: { date: "asc" } }),
    prisma.activityEntry.findMany({ orderBy: { startedAt: "asc" } })
  ]);

  return NextResponse.json({
    app: "Dayflow",
    exportFormat: "dayflow-json",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    purpose: "Complete local-first productivity data for analysis and external agents.",
    schemaVersion: 6,
    projects,
    phases,
    focusSessions,
    tasks,
    scheduleChanges,
    notes: notes.map((note) => ({ ...note, tags: parseTags(note.tags) })),
    diaryEntries,
    reviews,
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
