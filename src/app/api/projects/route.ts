import { clock, calendar } from "@/lib/time";
import { getPrisma } from "@/lib/prisma";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { parseProjectCreateMutation, readProjectMutationBody } from "@/modules/projects/domain/project";
import { createProject, getProjectDetail, listProjectSummaries, projectMutationErrorResponse } from "@/server/projects";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const now = clock.now();
  return NextResponse.json(await getPrisma().$transaction(tx => listProjectSummaries(tx, calendar.reviewPeriodEnding(calendar.dayOf(now)))));
}

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readProjectMutationBody(request);
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const input = parseProjectCreateMutation(body);
    const detail = await runOnce({
      mutationId,
      kind: "project.create",
      payload: body,
      create: async tx => {
        const project = await createProject(tx, input);
        const createdDetail = await getProjectDetail(project.id, tx, calendar.reviewPeriodEnding(calendar.dayOf(now)));
        if (!createdDetail) throw new Error("Created Project could not be read back.");
        return createdDetail;
      }
    });
    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    return projectMutationErrorResponse(error, "create");
  }
}
