import { prisma } from "@/lib/prisma";
import { parseTaskPathId } from "@/modules/planning/domain/task";
import { undoSchedule, taskMutationErrorResponse } from "@/server/tasks";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id: rawId } = await params;
    const id = parseTaskPathId(rawId);
    const task = await prisma.$transaction((tx) => undoSchedule(tx, id));
    return NextResponse.json(task);
  } catch (error) {
    return taskMutationErrorResponse(error, "undo");
  }
}
