import { getPrisma } from "@/lib/prisma";
import {
  parsePhasePatchMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/modules/projects/domain/project";
import { deletePhaseSafely, updatePhase, projectMutationErrorResponse } from "@/server/projects";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Phase");
    const body = await readProjectMutationBody(request);
    const data = parsePhasePatchMutation(body);
    const phase = await getPrisma().$transaction(tx => updatePhase(tx, id, data));
    return NextResponse.json(phase);
  } catch (error) {
    return projectMutationErrorResponse(error, "phase-save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Phase");
    await deletePhaseSafely(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return projectMutationErrorResponse(error, "phase-delete");
  }
}
