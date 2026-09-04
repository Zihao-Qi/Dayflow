import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { taskErrors } from "@/lib/task-errors";
import {
  parseWorkflowId
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      taskErrors.taskIdentifierIsInvalid.message
    );
    const result = await prisma.$transaction(async (transaction) => {
      const taskExists = await transaction.task.findUnique({
        where: { id },
        select: { id: true }
      });
      if (!taskExists) return { kind: "task-missing" as const };

      const latest = await transaction.taskScheduleChange.findFirst({
        where: { taskId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (!latest) return { kind: "change-missing" as const };

      const claimed = await transaction.taskScheduleChange.deleteMany({
        where: { id: latest.id, taskId: id }
      });
      if (claimed.count !== 1) throw new AppError(taskErrors.theScheduleChangedBeforeItCouldBeUndone);

      const task = await transaction.task.update({
        where: { id },
        data: { date: latest.previousDate }
      });
      return { kind: "success" as const, task };
    });

    if (result.kind === "task-missing") {
      return appErrorResponse(new AppError(taskErrors.taskNotFoundidNOTFOUND));
    }
    if (result.kind === "change-missing") {
      return appErrorResponse(new AppError(taskErrors.thereIsNoScheduleChangeToUndo));
    }
    return NextResponse.json(result.task);
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2003" || error.code === "P2025"))
    ) {
      return appErrorResponse(new AppError(taskErrors.theScheduleChangedBeforeItCouldBeUndone));
    }

    console.error("Task schedule undo failed.", error);
    return appErrorResponse(new AppError(taskErrors.theScheduleChangeCouldNotBeUndone));
  }
}
