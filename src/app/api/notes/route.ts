import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/dates";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const note = await prisma.note.create({
    data: {
      content: String(body.content ?? "").trim(),
      tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
      taskId: body.taskId || null,
      date: body.date ? startOfLocalDay(new Date(body.date)) : startOfLocalDay()
    }
  });
  return NextResponse.json({ ...note, tags: JSON.parse(note.tags) });
}
