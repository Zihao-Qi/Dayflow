import { prisma } from "@/lib/prisma";
import { addToFocusQueue, removeFromFocusQueue, reorderFocusQueue, focusQueueMutationErrorResponse } from "@/server/focus-queue";
import { parseFocusQueueAddMutation, parseFocusQueueRemoveMutation, parseFocusQueueReorderMutation, readFocusQueueMutationBody } from "@/modules/planning/domain/focus-queue";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await readFocusQueueMutationBody(request);
    const input = parseFocusQueueAddMutation(body);
    const tasks = await prisma.$transaction((tx) => addToFocusQueue(tx, input.taskId, input.placement));
    return NextResponse.json({ tasks });
  } catch (error) {
    return focusQueueMutationErrorResponse(error, "save");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readFocusQueueMutationBody(request);
    const input = parseFocusQueueReorderMutation(body);
    const tasks = await prisma.$transaction((tx) => reorderFocusQueue(tx, input.ids, input.expectedIds));
    return NextResponse.json({ tasks });
  } catch (error) {
    return focusQueueMutationErrorResponse(error, "reorder");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await readFocusQueueMutationBody(request);
    const input = parseFocusQueueRemoveMutation(body);
    const tasks = await prisma.$transaction((tx) => removeFromFocusQueue(tx, input.taskId));
    return NextResponse.json({ tasks });
  } catch (error) {
    return focusQueueMutationErrorResponse(error, "remove");
  }
}
