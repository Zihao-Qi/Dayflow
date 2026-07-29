import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  activityMutationErrorResponse
} from "@/lib/activity-http";
import {
  replaceManualActivity
} from "@/lib/activity-persistence";
import {
  parseActivityReplaceMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";
import { prisma } from "@/lib/prisma";
import {
  WorkflowMutationRequestError,
  parseWorkflowId
} from "@/lib/workflow-mutations";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      "Activity identifier is invalid."
    );
    const body = await readEvidenceMutationBody(request);
    const input = parseActivityReplaceMutation(body);
    const activity = await replaceManualActivity(id, input);
    return NextResponse.json(activity);
  } catch (error) {
    return activityMutationErrorResponse(
      error,
      "Activity update failed.",
      "Activity could not be updated."
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      "Activity identifier is invalid."
    );
    const result = await prisma.$transaction(async (transaction) => {
      const activity = await transaction.activityEntry.findUnique({
        where: { id },
        select: { focusSessionId: true, origin: true }
      });
      if (!activity) return "missing" as const;
      if (activity.focusSessionId || activity.origin === "FOCUS") {
        return "protected" as const;
      }

      const deleted = await transaction.activityEntry.deleteMany({
        where: {
          id,
          focusSessionId: null,
          origin: "MANUAL"
        }
      });
      if (deleted.count !== 1) throw new ActivityDeleteConflictError();
      return "deleted" as const;
    });

    if (result === "missing") {
      return NextResponse.json(
        { error: "Activity not found." },
        { status: 404 }
      );
    }
    if (result === "protected") {
      return NextResponse.json(
        { error: "Focus evidence cannot be deleted." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (
      error instanceof ActivityDeleteConflictError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2003" || error.code === "P2025"))
    ) {
      return NextResponse.json(
        {
          error: "The Activity changed before it could be deleted.",
          code: "CONFLICT"
        },
        { status: 409 }
      );
    }

    console.error("Activity deletion failed.", error);
    return NextResponse.json(
      { error: "Activity could not be deleted.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

class ActivityDeleteConflictError extends Error {}
