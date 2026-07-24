import { NextRequest, NextResponse } from "next/server";
import {
  FocusSessionConflictError,
  FocusSessionError,
  getFocusSnapshot,
  startFocusSession
} from "@/lib/focus-sessions";

export async function GET() {
  return NextResponse.json(await getFocusSnapshot());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const session = await startFocusSession({
      kind: body.kind,
      plannedMinutes: Number(body.plannedMinutes),
      label: body.label,
      taskId: body.taskId,
      projectId: body.projectId
    });
    return NextResponse.json({ session, snapshot: await getFocusSnapshot() }, { status: 201 });
  } catch (error) {
    if (error instanceof FocusSessionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error instanceof FocusSessionConflictError ? 409 : 400 }
      );
    }
    throw error;
  }
}
