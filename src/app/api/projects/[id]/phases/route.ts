import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProjectRuleError, validateProjectPlacement } from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const body = await request.json();
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Phase name is required." }, { status: 400 });
  }

  try {
    await validateProjectPlacement(projectId, null);
  } catch (error) {
    if (error instanceof ProjectRuleError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const lastPhase = await prisma.projectPhase.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" }
  });
  const phase = await prisma.projectPhase.create({
    data: {
      projectId,
      name,
      sortOrder: (lastPhase?.sortOrder ?? 0) + 1
    }
  });

  return NextResponse.json(phase, { status: 201 });
}
