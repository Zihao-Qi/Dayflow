import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { projectErrors } from "@/lib/project-errors";
import {
  parseProjectPatchMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/lib/project-mutations";
import {
  deleteProjectSafely,
  getProjectDetail
} from "@/lib/projects";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProjectDetail(id, prisma);
  if (!project) {
    return appErrorResponse(new AppError(projectErrors.projectDetailNotFound));
  }
  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Project");
    const body = await readProjectMutationBody(request);
    const input = parseProjectPatchMutation(body);
    const result = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.project.findUnique({
        where: { id },
        select: { id: true }
      });
      if (!existing) return { kind: "not-found" as const };

      if (input.data.status === "COMPLETED" && !input.confirmCompletion) {
        const unfinished = await transaction.task.count({
          where: { projectId: id, status: { not: "DONE" } }
        });
        if (unfinished) {
          return { kind: "confirmation-required" as const };
        }
      }

      await transaction.project.update({ where: { id }, data: input.data });
      const detail = await getProjectDetail(id, transaction);
      return detail
        ? { kind: "saved" as const, detail }
        : { kind: "not-found" as const };
    });
    if (result.kind === "not-found") return projectNotFoundResponse();
    if (result.kind === "confirmation-required") {
      return appErrorResponse(new AppError(projectErrors.confirmCompletionWhileUnfinishedTasksRemain));
    }
    return NextResponse.json(result.detail);
  } catch (error) {
    return projectMutationErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseProjectPathId(rawId, "id", "Project");
    if (request.nextUrl.searchParams.get("confirm") !== "true") {
      return appErrorResponse(new AppError(projectErrors.projectDeletionRequiresConfirmation));
    }

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!existing) return projectNotFoundResponse();

    await deleteProjectSafely(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return projectMutationErrorResponse(error, "delete");
  }
}

function projectNotFoundResponse() {
  return appErrorResponse(new AppError(projectErrors.projectNotFound));
}

function projectMutationErrorResponse(
  error: unknown,
  action: "save" | "delete" = "save"
) {
  if (error instanceof AppError) return appErrorResponse(error);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return projectNotFoundResponse();
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return appErrorResponse(new AppError(projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeSaved));
  }

  console.error(`Project ${action} failed.`, error);
  return appErrorResponse((action === "delete" ? new AppError(projectErrors.projectCouldNotBeDeleted) : new AppError(projectErrors.projectCouldNotBeSaved)));
}
