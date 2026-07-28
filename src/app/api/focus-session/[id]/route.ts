import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  FocusSessionConflictError,
  FocusSessionError,
  FocusSessionNotFoundError,
  getFocusSnapshot,
  transitionFocusSession
} from "@/lib/focus-sessions";
import {
  WorkflowMutationRequestError,
  parseFocusSessionTransitionMutation,
  parseWorkflowId,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      "Focus session identifier is invalid."
    );
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusSessionTransitionMutation(body);
    const result = await transitionFocusSession(id, input.action, input);
    return NextResponse.json({
      ...result,
      snapshot: await getFocusSnapshot()
    });
  } catch (error) {
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (error instanceof FocusSessionNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: "NOT_FOUND", field: "id" },
        { status: 404 }
      );
    }
    if (error instanceof FocusSessionError) {
      return NextResponse.json(
        {
          error: error.message,
          code:
            error instanceof FocusSessionConflictError
              ? "CONFLICT"
              : "VALIDATION_ERROR"
        },
        { status: error instanceof FocusSessionConflictError ? 409 : 400 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2025")
    ) {
      return NextResponse.json(
        {
          error: "The Focus session changed before it could be saved.",
          code: "CONFLICT"
        },
        { status: 409 }
      );
    }

    console.error("Focus session transition failed.", error);
    return NextResponse.json(
      { error: "Focus timer could not be saved.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
