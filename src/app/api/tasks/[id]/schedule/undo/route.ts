import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  WorkflowMutationRequestError,
  parseWorkflowId
} from "@/lib/workflow-mutations";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      "Task identifier is invalid."
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
      if (claimed.count !== 1) throw new ScheduleUndoConflictError();

      const task = await transaction.task.update({
        where: { id },
        data: { date: latest.previousDate }
      });
      return { kind: "success" as const, task };
    });

    if (result.kind === "task-missing") {
      return NextResponse.json(
        { error: "Task not found.", code: "NOT_FOUND", field: "id" },
        { status: 404 }
      );
    }
    if (result.kind === "change-missing") {
      return NextResponse.json(
        {
          error: "There is no schedule change to undo.",
          code: "NOT_FOUND",
          field: "scheduleChange"
        },
        { status: 404 }
      );
    }
    return NextResponse.json(result.task);
  } catch (error) {
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (
      error instanceof ScheduleUndoConflictError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2003" || error.code === "P2025"))
    ) {
      return NextResponse.json(
        {
          error: "The schedule changed before it could be undone.",
          code: "CONFLICT"
        },
        { status: 409 }
      );
    }

    console.error("Task schedule undo failed.", error);
    return NextResponse.json(
      {
        error: "The schedule change could not be undone.",
        code: "INTERNAL_ERROR"
      },
      { status: 500 }
    );
  }
}

class ScheduleUndoConflictError extends Error {}
