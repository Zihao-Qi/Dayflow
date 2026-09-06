import { clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { parseActivityCreateMutation, readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { parseMutationId, runIdempotentCreate } from "@/lib/idempotent-mutations";
import { createActivity, evidenceMutationErrorResponse } from "@/server/evidence";

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const body = await readEvidenceMutationBody(request);
    const input = parseActivityCreateMutation(body, now);
    const activity = await runIdempotentCreate({
      mutationId, kind: "activity.create", payload: body,
      create: tx => createActivity(tx, input)
    });
    return NextResponse.json(activity, { status: 201 });
  } catch (error) {
    return evidenceMutationErrorResponse(error, "create");
  }
}
