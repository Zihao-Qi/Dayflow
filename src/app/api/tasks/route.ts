import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";
import { ProjectRuleError, validateProjectPlacement } from "@/lib/projects";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const date =
    "date" in body
      ? body.date
        ? parseLocalDate(body.date)
        : null
      : startOfLocalDay();
  const projectId = String(body.projectId ?? "").trim() || null;
  const phaseId = String(body.phaseId ?? "").trim() || null;
  const status = body.status ?? "TODO";

  if ("date" in body && body.date && !date) {
    return NextResponse.json({ error: "Scheduled date is invalid." }, { status: 400 });
  }

  try {
    await validateProjectPlacement(projectId, phaseId, { allowCompleted: status === "DONE" });
  } catch (error) {
    if (error instanceof ProjectRuleError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const maxTask = await prisma.task.findFirst({
    where: { date },
    orderBy: { sortOrder: "desc" }
  });

  const task = await prisma.task.create({
    data: {
      title: String(body.title ?? "").trim() || "Untitled task",
      date,
      priority: body.priority ?? "MEDIUM",
      status,
      urgentScore: clampScore(body.urgentScore ?? 2),
      importanceScore: clampScore(body.importanceScore ?? 3),
      deadline: body.deadline ? parseLocalDate(body.deadline) : null,
      estimateMinutes: Number(body.estimateMinutes ?? 30),
      sortOrder: (maxTask?.sortOrder ?? 0) + 1,
      projectId,
      phaseId,
      completedAt: status === "DONE" ? new Date() : null
    }
  });

  return NextResponse.json(task);
}

function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.min(5, Math.max(1, Math.round(number)));
}
