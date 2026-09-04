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
  ] = await prisma.$transaction(async (tx) => Promise.all([
    tx.project.findMany({ orderBy: { updatedAt: "desc" } }),
    tx.projectPhase.findMany({ orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }] }),
    tx.focusSession.findMany({ orderBy: { startedAt: "desc" } }),
    tx.task.findMany({ orderBy: [{ date: "asc" }, { sortOrder: "asc" }] }),
    tx.taskScheduleChange.findMany({ orderBy: { createdAt: "desc" } }),
    tx.note.findMany({ orderBy: { createdAt: "desc" } }),
    tx.diaryEntry.findMany({ orderBy: { date: "desc" } }),
    tx.review.findMany({ orderBy: { periodStart: "desc" } }),
    tx.material.findMany({ orderBy: { createdAt: "desc" } }),
    tx.timeBlock.findMany({ orderBy: { date: "asc" } }),
    tx.activityEntry.findMany({ orderBy: { startedAt: "asc" } })
  ]));

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
