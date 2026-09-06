import { clock } from "@/lib/time";
import { focusErrors } from "@/lib/focus-errors";
import {
  getFocusSnapshot,
  transitionFocusSession
} from "@/lib/focus-sessions";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { workflowErrors } from "@/lib/workflow-errors";
import {
  parseFocusSessionTransitionMutation,
  parseWorkflowId,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const routeParams = await params;
    const id = parseWorkflowId(
      routeParams.id,
      "id",
      workflowErrors.focusSessionIdentifierIsInvalid.message
    );
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusSessionTransitionMutation(body);
    const result = await transitionFocusSession(id, input.action, input, now);
    return NextResponse.json({
      ...result,
      snapshot: await getFocusSnapshot(prisma, now)
    });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);


    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2025")
    ) {
      return appErrorResponse(new AppError(focusErrors.theFocusSessionChangedBeforeItCouldBeSaved));
    }

    console.error("Focus session transition failed.", error);
    return appErrorResponse(new AppError(focusErrors.focusTimerCouldNotBeSaved));
  }
}
