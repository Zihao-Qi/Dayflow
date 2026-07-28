import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import {
  EvidenceAttributionError,
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";

export async function POST(request: NextRequest) {
  const body = await request.json();
  let attribution;
  try {
    attribution = await resolveTaskProjectAttribution(
      body.taskId,
      body.projectId
    );
  } catch (error) {
    if (error instanceof EvidenceAttributionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const date =
    body.date === undefined || body.date === null || body.date === ""
      ? startOfLocalDay()
      : parseLocalDate(body.date);
  if (!date) {
    return NextResponse.json(
      { error: "Note date is invalid." },
      { status: 400 }
    );
  }

  const note = await prisma.note.create({
    data: {
      content: String(body.content ?? "").trim(),
      tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
      taskId: attribution.taskId,
      projectId: attribution.projectId,
      date
    }
  });
  return NextResponse.json({ ...note, tags: JSON.parse(note.tags) });
}
