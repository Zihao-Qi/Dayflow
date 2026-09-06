import {
  parseMutationId,
  runOnce
} from "@/server/prisma/run-once";
import {
  parsePhaseCreateMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/modules/projects/domain/project";
import { createPhase, projectMutationErrorResponse } from "@/server/projects";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: rawProjectId } = await params;
  try {
    const projectId = parseProjectPathId(
      rawProjectId,
      "projectId",
      "Project"
    );
    const body = await readProjectMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parsePhaseCreateMutation(body);

    const phase = await runOnce({
      mutationId,
      kind: "phase.create",
      payload: { projectId, ...body },
      create: (transaction) => createPhase(transaction, projectId, input)
    });

    return NextResponse.json(phase, { status: 201 });
  } catch (error) {
    return projectMutationErrorResponse(error, "phase-create");
  }
}
