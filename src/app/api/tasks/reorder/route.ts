import { prisma } from "@/lib/prisma";
import { parseTaskReorderMutation, readTaskMutationBody } from "@/modules/planning/domain/task";
import { reorderTasks, taskMutationErrorResponse } from "@/server/tasks";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await readTaskMutationBody(request);
    const { ids } = parseTaskReorderMutation(body);
    const tasks = await prisma.$transaction((tx) => reorderTasks(tx, ids));
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    return taskMutationErrorResponse(error, "reorder");
  }
}
