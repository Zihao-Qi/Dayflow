import { clock } from "@/lib/time";
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const now = clock.now();
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
  ] = await getPrisma().$transaction(async (tx) => Promise.all([
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
  ]), { timeout: 60000 });

  return NextResponse.json({
    app: "Dayflow",
    exportFormat: "dayflow-json",
    exportVersion: 1,
    exportedAt: now.toISOString(),
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
