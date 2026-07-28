import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  ProjectMutationRequestError,
  parsePhaseCreateMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/lib/project-mutations";

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

    const phase = await runIdempotentCreate({
      mutationId,
      kind: "phase.create",
      payload: { projectId, ...body },
      create: async (transaction) => {
        const project = await transaction.project.findUnique({
          where: { id: projectId },
          select: { status: true }
        });
        if (!project) {
          throw new ProjectMutationRequestError(
            "The selected project could not be found.",
            "projectId",
            "NOT_FOUND",
            404
          );
        }
        if (project.status === "COMPLETED") {
          throw new ProjectMutationRequestError(
            "Reopen the completed project before adding unfinished work.",
            "projectId",
            "RELATIONSHIP_CONFLICT",
            409
          );
        }

        const lastPhase = await transaction.projectPhase.findFirst({
          where: { projectId },
          orderBy: { sortOrder: "desc" }
        });
        return transaction.projectPhase.create({
          data: {
            projectId,
            name: input.name,
            sortOrder: (lastPhase?.sortOrder ?? 0) + 1
          }
        });
      }
    });

    return NextResponse.json(phase, { status: 201 });
  } catch (error) {
    return phaseCreateErrorResponse(error);
  }
}

function phaseCreateErrorResponse(error: unknown) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (error instanceof ProjectMutationRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code, field: error.field },
      { status: error.status }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "The selected Project is no longer available.",
        code: "CONFLICT",
        field: "projectId"
      },
      { status: 409 }
    );
  }

  console.error("Phase creation failed.", error);
  return NextResponse.json(
    {
      error: "Phase could not be created.",
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}
