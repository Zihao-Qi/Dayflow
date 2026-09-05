import { clock, calendar } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { parseTaskPatchInput, parseTaskPathId, readTaskMutationBody } from "@/modules/planning/domain/task";
import { updateTask, deleteTask, taskMutationErrorResponse } from "@/server/tasks";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  const { id: rawId } = await params;
  try {
    const id = parseTaskPathId(rawId);
    const body = await readTaskMutationBody(request);
    const input = parseTaskPatchInput(body, now);
    const task = await prisma.$transaction((tx) => updateTask(tx, id, input, calendar, now));
    return NextResponse.json(task);
  } catch (error) {
    return taskMutationErrorResponse(error, "save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTaskPathId(rawId);
    const result = await prisma.$transaction((tx) => deleteTask(tx, id));
    return NextResponse.json(result);
  } catch (error) {
    return taskMutationErrorResponse(error, "delete");
  }
}
