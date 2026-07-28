import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import {
  EvidenceAttributionError,
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const durationMinutes = Number(body.durationMinutes);
  const note = String(body.note ?? "").trim();
  const category = String(body.category ?? "").trim() || "Deep Work";

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 1440
  ) {
    return NextResponse.json(
      { error: "Duration must be between 1 and 1440 minutes." },
      { status: 400 }
    );
  }

  if (!note) {
    return NextResponse.json({ error: "Add a short note about what happened." }, { status: 400 });
  }

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

  const sourceDate =
    body.date === undefined || body.date === null || body.date === ""
      ? new Date()
      : parseLocalDate(body.date);
  if (!sourceDate) {
    return NextResponse.json(
      { error: "Activity date is invalid." },
      { status: 400 }
    );
  }
  const startedAt = startOfLocalDay(sourceDate);
  const time = parseTime(body.startTime);
  if (!time) {
    return NextResponse.json(
      { error: "Activity start time is invalid." },
      { status: 400 }
    );
  }
  startedAt.setHours(time.hours, time.minutes, 0, 0);

  const activity = await prisma.activityEntry.create({
    data: {
      startedAt,
      durationMinutes: Math.round(durationMinutes),
      category,
      note,
      taskId: attribution.taskId,
      projectId: attribution.projectId,
      attributedProjectId: attribution.attributedProjectId
    }
  });

  return NextResponse.json(activity, { status: 201 });
}

function parseTime(value: unknown) {
  if (value === undefined || value === null || value === "") {
    const now = new Date();
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  if (match) {
    return { hours: Number(match[1]), minutes: Number(match[2]) };
  }

  return null;
}
