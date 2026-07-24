import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deletePhaseSafely } from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const data: { name?: string; sortOrder?: number } = {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Phase name is required." }, { status: 400 });
    }
    data.name = name;
  }
  if ("sortOrder" in body) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "Phase order is invalid." }, { status: 400 });
    }
    data.sortOrder = Math.round(sortOrder);
  }

  const phase = await prisma.projectPhase.update({ where: { id }, data });
  return NextResponse.json(phase);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await deletePhaseSafely(id);
  return NextResponse.json({ ok: true });
}
