import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ProjectMutationRequestError,
  parseProjectPathId,
  parseProjectPatchMutation,
  readProjectMutationBody
} from "@/lib/project-mutations";
import {
  deleteProjectSafely,
  getProjectDetail
} from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProjectDetail(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
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
      return NextResponse.json(
        {
          error: "Confirm completion while unfinished tasks remain.",
          code: "CONFLICT",
          field: "status",
          requiresConfirmation: true
        },
        { status: 409 }
      );
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
      return NextResponse.json(
        {
          error: "Project deletion requires confirmation.",
          code: "VALIDATION_ERROR",
          field: "confirm"
        },
        { status: 400 }
      );
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
  return NextResponse.json(
    { error: "Project not found.", code: "NOT_FOUND" },
    { status: 404 }
  );
}

function projectMutationErrorResponse(
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
    return projectNotFoundResponse();
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "A related record changed before the Project could be saved.",
        code: "CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error(`Project ${action} failed.`, error);
  return NextResponse.json(
    {
      error:
        action === "delete"
          ? "Project could not be deleted."
          : "Project could not be saved.",
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}
