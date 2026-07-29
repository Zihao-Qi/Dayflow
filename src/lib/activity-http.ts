import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  ActivityPersistenceError
} from "@/lib/activity-persistence";
import {
  EvidenceAttributionError
} from "@/lib/evidence-attribution";
import {
  EvidenceMutationRequestError
} from "@/lib/evidence-mutations";
import {
  IdempotentMutationError
} from "@/lib/idempotent-mutations";
import {
  WorkflowMutationRequestError
} from "@/lib/workflow-mutations";

export function activityMutationErrorResponse(
  error: unknown,
  logMessage: string,
  fallbackMessage = "Activity could not be saved."
) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (
    error instanceof EvidenceMutationRequestError ||
    error instanceof WorkflowMutationRequestError
  ) {
    return NextResponse.json(
      { error: error.message, code: error.code, field: error.field },
      { status: 400 }
    );
  }
  if (error instanceof EvidenceAttributionError) {
    return NextResponse.json(
      { error: error.message, code: error.code, field: error.field },
      { status: error.status }
    );
  }
  if (error instanceof ActivityPersistenceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2025")
  ) {
    return NextResponse.json(
      {
        error: "The linked Activity relationship is no longer available.",
        code: "RELATIONSHIP_CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error(logMessage, error);
  return NextResponse.json(
    { error: fallbackMessage, code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
