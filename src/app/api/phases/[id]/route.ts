import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { projectErrors } from "@/lib/project-errors";
import {
  parsePhasePatchMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/lib/project-mutations";
import { deletePhaseSafely } from "@/lib/projects";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

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
  if (error instanceof AppError) return appErrorResponse(error);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return appErrorResponse(new AppError(projectErrors.phaseNotFound));
  }

  console.error(`Phase ${action} failed.`, error);
  return appErrorResponse((action === "delete" ? new AppError(projectErrors.phaseCouldNotBeDeleted) : new AppError(projectErrors.phaseCouldNotBeSaved)));
}
