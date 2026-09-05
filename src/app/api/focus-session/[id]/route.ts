import { clock } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { readWorkflowMutationBody } from "@/lib/workflow-mutations";
import { parseFocusSessionId, parseFocusSessionTransitionMutation } from "@/modules/focus/domain/session";
import { readSnapshot, transitionSession, enrichSession, focusErrorResponse } from "@/server/focus";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const routeParams = await params;
    const id = parseFocusSessionId(routeParams.id, "id");
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusSessionTransitionMutation(body);
    const result = await prisma.$transaction(tx => input.action === "enrich" || input.action === "record"
      ? enrichSession(tx, id, input, now)
      : transitionSession(tx, id, input.action, now));
    return NextResponse.json({ ...result, snapshot: await readSnapshot(prisma, now) });
  } catch (error) { return focusErrorResponse(error, "save"); }
}
