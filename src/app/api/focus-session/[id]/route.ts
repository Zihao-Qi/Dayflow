import { NextRequest, NextResponse } from "next/server";
import {
  FocusSessionError,
  getFocusSnapshot,
  transitionFocusSession
} from "@/lib/focus-sessions";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();

  try {
    const result = await transitionFocusSession(id, String(body.action ?? ""));
    return NextResponse.json({
      ...result,
      snapshot: await getFocusSnapshot()
    });
  } catch (error) {
    if (error instanceof FocusSessionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
