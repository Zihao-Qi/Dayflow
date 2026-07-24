import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/dates";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = String(body.projectId ?? "").trim() || null;
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });
    if (!project) {
      return NextResponse.json({ error: "The linked project could not be found." }, { status: 400 });
    }
  }

  const note = await prisma.note.create({
    data: {
      content: String(body.content ?? "").trim(),
      tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
      taskId: body.taskId || null,
      projectId,
      date: body.date ? startOfLocalDay(new Date(body.date)) : startOfLocalDay()
    }
  });
  return NextResponse.json({ ...note, tags: JSON.parse(note.tags) });
}
