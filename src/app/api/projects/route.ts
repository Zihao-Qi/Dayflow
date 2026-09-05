import { appErrorResponse } from "@/lib/http-errors";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { prisma } from "@/lib/prisma";
import { projectErrors } from "@/lib/project-errors";
import {
  parseProjectCreateMutation,
  readProjectMutationBody
} from "@/lib/project-mutations";
import { getProjectDetail, listProjectSummaries } from "@/lib/projects";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(await listProjectSummaries(prisma));
}

export async function POST(request: NextRequest) {
  try {
    const body = await readProjectMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseProjectCreateMutation(body);

    const detail = await runIdempotentCreate({
      mutationId,
      kind: "project.create",
      payload: body,
      create: async (transaction) => {
        const project = await transaction.project.create({
          data: input
        });
        const createdDetail = await getProjectDetail(project.id, transaction);
        if (!createdDetail) {
          throw new Error("Created Project could not be read back.");
        }
        return createdDetail;
      }
    });

    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    return projectCreateErrorResponse(error);
  }
}

function projectCreateErrorResponse(error: unknown) {
  if (error instanceof AppError) return appErrorResponse(error);

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return appErrorResponse(new AppError(projectErrors.aRelatedRecordChangedBeforeTheProjectCouldBeCreated));
  }

  console.error("Project creation failed.", error);
  return appErrorResponse(new AppError(projectErrors.projectCouldNotBeCreated));
}
