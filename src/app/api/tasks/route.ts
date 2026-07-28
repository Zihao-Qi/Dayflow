import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { ProjectRuleError, validateProjectPlacement } from "@/lib/projects";
import {
  TaskMutationValidationError,
  parseTaskCreateMutation,
  readTaskMutationBody,
  taskProjectRuleErrorDetails
} from "@/lib/task-mutations";

export async function POST(request: NextRequest) {
  try {
    const body = await readTaskMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseTaskCreateMutation(body);

    const task = await runIdempotentCreate({
      mutationId,
      kind: "task.create",
      payload: body,
      create: async (transaction) => {
        await validateProjectPlacement(
          input.projectId,
          input.phaseId,
          { allowCompleted: input.status === "DONE" },
          transaction
        );
        const maxTask = await transaction.task.findFirst({
          where: { date: input.date },
          orderBy: { sortOrder: "desc" }
        });
        return transaction.task.create({
          data: {
            ...input,
            sortOrder: (maxTask?.sortOrder ?? 0) + 1
          }
        });
      }
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return taskMutationErrorResponse(error);
  }
}

function taskMutationErrorResponse(error: unknown) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (error instanceof TaskMutationValidationError) {
    return NextResponse.json(
      { error: error.message, code: error.code, field: error.field },
      { status: 400 }
    );
  }
  if (error instanceof ProjectRuleError) {
    const relationshipError = taskProjectRuleErrorDetails(error.message);
    return NextResponse.json(
      {
        error: error.message,
        code: relationshipError.code,
        field: relationshipError.field
      },
      { status: relationshipError.status }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "The selected task relationship is no longer available.",
        code: "CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error("Task creation failed.", error);
  return NextResponse.json(
    { error: "Task could not be created.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
