import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/dates";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const durationMinutes = Number(body.durationMinutes);
  const note = String(body.note ?? "").trim();
  const category = String(body.category ?? "").trim() || "Deep Work";
  const taskId = String(body.taskId ?? "").trim() || null;

  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    return NextResponse.json(
      { error: "Duration must be between 1 and 1440 minutes." },
      { status: 400 }
    );
  }

  if (!note) {
    return NextResponse.json({ error: "Add a short note about what happened." }, { status: 400 });
  }

  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) {
      return NextResponse.json({ error: "The linked task could not be found." }, { status: 400 });
    }
  }

  const sourceDate = body.date ? new Date(body.date) : new Date();
  const startedAt = startOfLocalDay(Number.isNaN(sourceDate.getTime()) ? new Date() : sourceDate);
  const time = parseTime(body.startTime);
  startedAt.setHours(time.hours, time.minutes, 0, 0);

  const activity = await prisma.activityEntry.create({
    data: {
      startedAt,
      durationMinutes: Math.round(durationMinutes),
      category,
      note,
      taskId
    }
  });

  return NextResponse.json(activity, { status: 201 });
}

function parseTime(value: unknown) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  if (match) {
    return { hours: Number(match[1]), minutes: Number(match[2]) };
  }

  const now = new Date();
  return { hours: now.getHours(), minutes: now.getMinutes() };
}
