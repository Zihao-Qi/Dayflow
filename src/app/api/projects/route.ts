import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  ProjectMutationRequestError,
  parseProjectCreateMutation,
  readProjectMutationBody
} from "@/lib/project-mutations";
import { prisma } from "@/lib/prisma";
import { getProjectDetail, listProjectSummaries } from "@/lib/projects";

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
        error: "A related record changed before the Project could be created.",
        code: "CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error("Project creation failed.", error);
  return NextResponse.json(
    { error: "Project could not be created.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
