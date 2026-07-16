import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const data: Record<string, unknown> = {};

  for (const key of ["title", "priority", "status", "estimateMinutes", "actualMinutes", "sortOrder"]) {
    if (key in body) data[key] = body[key];
  }

  if ("urgentScore" in body) data.urgentScore = clampScore(body.urgentScore);
  if ("importanceScore" in body) data.importanceScore = clampScore(body.importanceScore);
  if (body.status === "DONE") data.completedAt = new Date();
  if (body.status && body.status !== "DONE") data.completedAt = null;
  if (body.date) data.date = new Date(body.date);
  if ("deadline" in body) data.deadline = body.deadline ? new Date(body.deadline) : null;

  const task = await prisma.task.update({ where: { id }, data });
  return NextResponse.json(task);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.min(5, Math.max(1, Math.round(number)));
}
