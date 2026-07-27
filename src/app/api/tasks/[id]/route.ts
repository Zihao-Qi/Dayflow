import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/dates";
import {
  compactFocusQueue,
  consumeFocusQueueTask
} from "@/lib/focus-queue";
import { ProjectRuleError, validateProjectPlacement } from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const data: Record<string, unknown> = {};
  const current = await prisma.task.findUnique({
    where: { id },
    select: { date: true, projectId: true, phaseId: true, status: true }
  });

  if (!current) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  for (const key of ["title", "priority", "status", "estimateMinutes", "actualMinutes", "sortOrder"]) {
    if (key in body) data[key] = body[key];
  }

  if ("urgentScore" in body) data.urgentScore = clampScore(body.urgentScore);
  if ("importanceScore" in body) data.importanceScore = clampScore(body.importanceScore);
  if (body.status === "DONE") data.completedAt = new Date();
  if (body.status && body.status !== "DONE") data.completedAt = null;
  if ("date" in body) {
    const date = body.date ? parseLocalDate(body.date) : null;
    if (body.date && !date) {
      return NextResponse.json({ error: "Scheduled date is invalid." }, { status: 400 });
    }
    data.date = date;
  }
  if ("deadline" in body) data.deadline = body.deadline ? parseLocalDate(body.deadline) : null;
  const projectId =
    "projectId" in body ? String(body.projectId ?? "").trim() || null : current.projectId;
  const phaseId =
    "phaseId" in body
      ? String(body.phaseId ?? "").trim() || null
      : projectId === current.projectId
        ? current.phaseId
        : null;
  const status = body.status ?? current.status;

  try {
    await validateProjectPlacement(projectId, phaseId, { allowCompleted: status === "DONE" });
  } catch (error) {
    if (error instanceof ProjectRuleError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if ("projectId" in body || projectId !== current.projectId) data.projectId = projectId;
  if ("phaseId" in body || phaseId !== current.phaseId) data.phaseId = phaseId;

  const nextDate = "date" in data ? (data.date as Date | null) : current.date;
  const dateChanged = current.date?.getTime() !== nextDate?.getTime();

  const task = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.task.update({ where: { id }, data });
    if (body.status === "DONE") {
      await consumeFocusQueueTask(transaction, id);
    }
    if (dateChanged) {
      await transaction.taskScheduleChange.create({
        data: {
          taskId: id,
          previousDate: current.date,
          nextDate,
          source: String(body.scheduleSource ?? "manual")
        }
      });
    }
    return updated;
  });
  return NextResponse.json(task);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.$transaction(async (transaction) => {
    await transaction.task.delete({ where: { id } });
    await compactFocusQueue(transaction);
  });
  return NextResponse.json({ ok: true });
}

function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.min(5, Math.max(1, Math.round(number)));
}
