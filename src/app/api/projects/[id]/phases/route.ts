import { appErrorResponse } from "@/lib/http-errors";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { projectErrors } from "@/lib/project-errors";
import {
  parsePhaseCreateMutation,
  parseProjectPathId,
  readProjectMutationBody
} from "@/lib/project-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
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
          throw new AppError(projectErrors.phaseParentNotFound);
        }
        if (project.status === "COMPLETED") {
          throw new AppError(projectErrors.reopenTheCompletedProjectBeforeAddingUnfinishedWork);
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
  if (error instanceof AppError) return appErrorResponse(error);

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return appErrorResponse(new AppError(projectErrors.theSelectedProjectIsNoLongerAvailable));
  }

  console.error("Phase creation failed.", error);
  return appErrorResponse(new AppError(projectErrors.phaseCouldNotBeCreated));
}
