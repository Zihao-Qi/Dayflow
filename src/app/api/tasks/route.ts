import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { validateProjectPlacement } from "@/lib/projects";
import { taskErrors } from "@/lib/task-errors";
import {
  parseTaskCreateMutation,
  readTaskMutationBody
} from "@/lib/task-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readTaskMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseTaskCreateMutation(body, now);

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
  if (error instanceof AppError) return appErrorResponse(error);


  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return appErrorResponse(new AppError(taskErrors.theSelectedTaskRelationshipIsNoLongerAvailable));
  }

  console.error("Task creation failed.", error);
  return appErrorResponse(new AppError(taskErrors.taskCouldNotBeCreated));
}
