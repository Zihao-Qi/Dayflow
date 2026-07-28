import { NextRequest, NextResponse } from "next/server";
import {
  FocusSessionConflictError,
  FocusSessionError,
  getFocusSnapshot,
  transitionFocusSession
} from "@/lib/focus-sessions";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();

  try {
    const result = await transitionFocusSession(id, String(body.action ?? ""), body);
    return NextResponse.json({
      ...result,
      snapshot: await getFocusSnapshot()
    });
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
