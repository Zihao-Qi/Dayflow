import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/dates";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const date = body.date ? startOfLocalDay(new Date(body.date)) : startOfLocalDay();
  const maxTask = await prisma.task.findFirst({
    where: { date },
    orderBy: { sortOrder: "desc" }
  });

  const task = await prisma.task.create({
    data: {
      title: String(body.title ?? "").trim() || "Untitled task",
      date,
      priority: body.priority ?? "MEDIUM",
      status: body.status ?? "TODO",
      urgentScore: clampScore(body.urgentScore ?? 2),
      importanceScore: clampScore(body.importanceScore ?? 3),
      deadline: body.deadline ? new Date(body.deadline) : null,
      estimateMinutes: Number(body.estimateMinutes ?? 30),
      sortOrder: (maxTask?.sortOrder ?? 0) + 1
    }
  });

  return NextResponse.json(task);
}

function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.min(5, Math.max(1, Math.round(number)));
}
