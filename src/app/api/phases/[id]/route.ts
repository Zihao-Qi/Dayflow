import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ProjectMutationRequestError,
  parsePhasePatchMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/lib/project-mutations";
import { deletePhaseSafely } from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Phase");
    const body = await readProjectMutationBody(request);
    const data = parsePhasePatchMutation(body);
    const phase = await prisma.projectPhase.update({ where: { id }, data });
    return NextResponse.json(phase);
  } catch (error) {
    return phaseMutationErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Phase");
    await deletePhaseSafely(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return phaseMutationErrorResponse(error, "delete");
  }
}

function phaseMutationErrorResponse(
  error: unknown,
  action: "save" | "delete" = "save"
) {
  if (error instanceof ProjectMutationRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code, field: error.field },
      { status: error.status }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return NextResponse.json(
      { error: "Phase not found.", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  console.error(`Phase ${action} failed.`, error);
  return NextResponse.json(
    {
      error:
        action === "delete"
          ? "Phase could not be deleted."
          : "Phase could not be saved.",
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}
