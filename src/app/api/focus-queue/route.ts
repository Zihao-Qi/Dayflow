import {
  addToFocusQueue,
  removeFromFocusQueue,
  reorderFocusQueue
} from "@/lib/focus-queue";
import { focusQueueErrors } from "@/lib/focus-queue-errors";
import { appErrorResponse } from "@/lib/http-errors";
import {
  parseFocusQueueAddMutation,
  parseFocusQueueRemoveMutation,
  parseFocusQueueReorderMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return respond(async () => {
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusQueueAddMutation(body);
    return addToFocusQueue(input.taskId, input.placement);
  }, "save");
}

export async function PATCH(request: NextRequest) {
  return respond(async () => {
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusQueueReorderMutation(body);
    return reorderFocusQueue(input.ids, input.expectedIds);
  }, "reorder");
}

export async function DELETE(request: NextRequest) {
  return respond(async () => {
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusQueueRemoveMutation(body);
    return removeFromFocusQueue(input.taskId);
  }, "remove");
}

async function respond(
  action: () => Promise<unknown>,
  operation: "save" | "reorder" | "remove"
) {
  try {
    return NextResponse.json({ tasks: await action() });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);



    console.error(`Focus queue ${operation} failed.`, error);
    return appErrorResponse(new AppError(focusQueueErrors.focusQueueCouldNotBeSaved));
  }
}
