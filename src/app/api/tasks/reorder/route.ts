import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { taskErrors } from "@/lib/task-errors";
import {
  parseTaskReorderMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await readWorkflowMutationBody(request);
    const { ids } = parseTaskReorderMutation(body);

    const tasks = await prisma.$transaction(async (transaction) => {
      const current = await transaction.task.findMany({
        where: { id: { in: ids } }
      });
      if (current.length !== ids.length) return null;

      for (const [index, id] of ids.entries()) {
        await transaction.task.update({
          where: { id },
          data: { sortOrder: index + 1 }
        });
      }

      const persisted = await transaction.task.findMany({
        where: { id: { in: ids } }
      });
      const byId = new Map(persisted.map((task) => [task.id, task]));
      return ids.map((id) => byId.get(id)!);
    });

    if (!tasks) {
      return appErrorResponse(new AppError(taskErrors.oneOrMoreTasksCouldNotBeFound));
    }
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return appErrorResponse(new AppError(taskErrors.aTaskChangedBeforeItsOrderCouldBeSaved));
    }

    console.error("Task reorder failed.", error);
    return appErrorResponse(new AppError(taskErrors.taskOrderCouldNotBeSaved));
  }
}
