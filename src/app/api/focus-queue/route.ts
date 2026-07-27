import { NextRequest, NextResponse } from "next/server";
import {
  addToFocusQueue,
  FocusQueueError,
  FocusQueueNotFoundError,
  parseQueuePlacement,
  removeFromFocusQueue,
  reorderFocusQueue
} from "@/lib/focus-queue";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const taskId = String(body.taskId ?? "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Choose a task to queue." }, { status: 400 });
  }
  return respond(() =>
    addToFocusQueue(taskId, parseQueuePlacement(body.placement))
  );
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const ids = Array.isArray(body.ids)
    ? body.ids.map((id: unknown) => String(id))
    : [];
  const expectedIds = Array.isArray(body.expectedIds)
    ? body.expectedIds.map((id: unknown) => String(id))
    : [];
  return respond(() => reorderFocusQueue(ids, expectedIds));
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const taskId = String(body.taskId ?? "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Choose a queued task." }, { status: 400 });
  }
  return respond(() => removeFromFocusQueue(taskId));
}

async function respond(action: () => Promise<unknown>) {
  try {
    return NextResponse.json({ tasks: await action() });
  } catch (error) {
    if (error instanceof FocusQueueNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof FocusQueueError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
