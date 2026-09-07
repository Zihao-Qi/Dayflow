import { clock, calendar } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { getPrisma } from "@/lib/prisma";
import { projectErrors } from "@/modules/projects/domain/project";
import {
  parseProjectPatchMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/modules/projects/domain/project";
import {
  deleteProjectSafely,
  getProjectDetail,
  projectMutationErrorResponse
} from "@/server/projects";
import { AppError } from "@/shared/kernel/errors";
import { completeProject } from "@/server/workflows/complete-project";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const now = clock.now();
  const { id } = await params;
  const project = await getPrisma().$transaction(tx => getProjectDetail(id, tx, calendar.reviewPeriodEnding(calendar.dayOf(now))));
  if (!project) {
    return appErrorResponse(new AppError(projectErrors.projectDetailNotFound));
  }
  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Project");
    const body = await readProjectMutationBody(request);
    const input = parseProjectPatchMutation(body);
    const result = await completeProject(id, input, calendar.reviewPeriodEnding(calendar.dayOf(now)));
    if (result.kind === "not-found") return projectNotFoundResponse();
    if (result.kind === "confirmation-required") {
      return appErrorResponse(new AppError(projectErrors.confirmCompletionWhileUnfinishedTasksRemain));
    }
    return NextResponse.json(result.detail);
  } catch (error) {
    return projectMutationErrorResponse(error, "save");
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Project");
    if (request.nextUrl.searchParams.get("confirm") !== "true") {
      return appErrorResponse(new AppError(projectErrors.projectDeletionRequiresConfirmation));
    }

    await deleteProjectSafely(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return projectMutationErrorResponse(error, "delete");
  }
}

function projectNotFoundResponse() {
  return appErrorResponse(new AppError(projectErrors.projectNotFound));
}
