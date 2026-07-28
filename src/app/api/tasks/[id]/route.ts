import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  compactFocusQueue,
  consumeFocusQueueTask
} from "@/lib/focus-queue";
import { ProjectRuleError, validateProjectPlacement } from "@/lib/projects";
import {
  TaskMutationValidationError,
  parseTaskPatchMutation,
  parseTaskPathId,
  readTaskMutationBody,
  taskProjectRuleErrorDetails,
  validateTaskPatchMutation
} from "@/lib/task-mutations";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTaskPathId(rawId);
    const body = await readTaskMutationBody(request);
    const mutationTime = new Date();
    validateTaskPatchMutation(body, mutationTime);
    const task = await prisma.$transaction(async (transaction) => {
      const current = await transaction.task.findUnique({
        where: { id },
        select: { date: true, projectId: true, phaseId: true, status: true }
      });
      if (!current) return null;

      const input = parseTaskPatchMutation(body, current, mutationTime);
      await validateProjectPlacement(
        input.projectId,
        input.phaseId,
        { allowCompleted: input.status === "DONE" },
        transaction
      );
      const nextDate = Object.prototype.hasOwnProperty.call(input.data, "date")
        ? (input.data.date ?? null)
        : current.date;
      const dateChanged = current.date?.getTime() !== nextDate?.getTime();

      await transaction.task.update({ where: { id }, data: input.data });
      if (input.requestedStatus === "DONE") {
        await consumeFocusQueueTask(transaction, id);
      }
      if (dateChanged) {
        await transaction.taskScheduleChange.create({
          data: {
            taskId: id,
            previousDate: current.date,
            nextDate,
            source: input.scheduleSource
          }
        });
      }
      return transaction.task.findUniqueOrThrow({ where: { id } });
    });
    if (!task) return taskNotFoundResponse();
    return NextResponse.json(task);
  } catch (error) {
    return taskMutationErrorResponse(error, "save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTaskPathId(rawId);
    await prisma.$transaction(async (transaction) => {
      await transaction.task.delete({ where: { id } });
      await compactFocusQueue(transaction);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return taskMutationErrorResponse(error, "delete");
  }
}

function taskNotFoundResponse() {
  return NextResponse.json(
    { error: "Task not found.", code: "NOT_FOUND" },
    { status: 404 }
  );
}

function taskMutationErrorResponse(
  error: unknown,
  action: "save" | "delete"
) {
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
    error.code === "P2025"
  ) {
    return taskNotFoundResponse();
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "A related record changed before the task could be saved.",
        code: "CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error(`Task ${action} failed.`, error);
  return NextResponse.json(
    {
      error:
        action === "delete"
          ? "Task could not be deleted."
          : "Task could not be saved.",
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}
