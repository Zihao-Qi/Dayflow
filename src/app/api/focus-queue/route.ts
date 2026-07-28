import { NextRequest, NextResponse } from "next/server";
import {
  addToFocusQueue,
  FocusQueueConflictError,
  FocusQueueError,
  FocusQueueNotFoundError,
  removeFromFocusQueue,
  reorderFocusQueue
} from "@/lib/focus-queue";
import {
  WorkflowMutationRequestError,
  parseFocusQueueAddMutation,
  parseFocusQueueRemoveMutation,
  parseFocusQueueReorderMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";

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
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (error instanceof FocusQueueNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: "NOT_FOUND", field: "taskId" },
        { status: 404 }
      );
    }
    if (error instanceof FocusQueueConflictError) {
      return NextResponse.json(
        { error: error.message, code: "CONFLICT" },
        { status: 409 }
      );
    }
    if (error instanceof FocusQueueError) {
      return NextResponse.json(
        { error: error.message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    console.error(`Focus queue ${operation} failed.`, error);
    return NextResponse.json(
      { error: "Focus queue could not be saved.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
