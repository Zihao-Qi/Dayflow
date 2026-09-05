import {
  activityMutationErrorResponse
} from "@/lib/activity-http";
import {
  replaceManualActivity
} from "@/lib/activity-persistence";
import { evidenceErrors } from "@/lib/evidence-errors";
import {
  parseActivityReplaceMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import {
  parseWorkflowId
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      evidenceErrors.activityIdentifierIsInvalid.message
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
      evidenceErrors.activityIdentifierIsInvalid.message
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
      if (deleted.count !== 1) throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeDeleted);
      return "deleted" as const;
    });

    if (result === "missing") {
      return appErrorResponse(new AppError(evidenceErrors.activityDeleteNotFound));
    }
    if (result === "protected") {
      return appErrorResponse(new AppError(evidenceErrors.focusEvidenceCannotBeDeleted));
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2003" || error.code === "P2025"))
    ) {
      return appErrorResponse(new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeDeleted));
    }

    console.error("Activity deletion failed.", error);
    return appErrorResponse(new AppError(evidenceErrors.activityCouldNotBeDeleted));
  }
}
