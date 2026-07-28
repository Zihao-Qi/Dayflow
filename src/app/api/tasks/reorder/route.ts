import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  WorkflowMutationRequestError,
  parseTaskReorderMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";

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
      return NextResponse.json(
        {
          error: "One or more tasks could not be found.",
          code: "NOT_FOUND",
          field: "ids"
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        {
          error: "A task changed before its order could be saved.",
          code: "CONFLICT"
        },
        { status: 409 }
      );
    }

    console.error("Task reorder failed.", error);
    return NextResponse.json(
      { error: "Task order could not be saved.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
