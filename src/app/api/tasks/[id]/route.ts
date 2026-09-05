import { clock } from "@/lib/time";
import {
  compactFocusQueue,
  consumeFocusQueueTask
} from "@/lib/focus-queue";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { validateProjectPlacement } from "@/lib/projects";
import { taskErrors } from "@/lib/task-errors";
import {
  parseTaskPatchMutation,
  parseTaskPathId,
  readTaskMutationBody,
  validateTaskPatchMutation
} from "@/lib/task-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  const { id: rawId } = await params;
  try {
    const id = parseTaskPathId(rawId);
    const body = await readTaskMutationBody(request);
    validateTaskPatchMutation(body, now);
    const task = await prisma.$transaction(async (transaction) => {
      const current = await transaction.task.findUnique({
        where: { id },
        select: { date: true, projectId: true, phaseId: true, status: true }
      });
      if (!current) return null;

      const input = parseTaskPatchMutation(body, current, now);
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
  return appErrorResponse(new AppError(taskErrors.taskNotFound));
}

function taskMutationErrorResponse(
  error: unknown,
  action: "save" | "delete"
) {
  if (error instanceof AppError) return appErrorResponse(error);

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
    return appErrorResponse(new AppError(taskErrors.aRelatedRecordChangedBeforeTheTaskCouldBeSaved));
  }

  console.error(`Task ${action} failed.`, error);
  return appErrorResponse((action === "delete" ? new AppError(taskErrors.taskCouldNotBeDeleted) : new AppError(taskErrors.taskCouldNotBeSaved)));
}
