import { NextRequest, NextResponse } from "next/server";
import {
  activityMutationErrorResponse
} from "@/lib/activity-http";
import {
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";
import {
  parseActivityCreateMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";

export async function POST(request: NextRequest) {
  try {
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const body = await readEvidenceMutationBody(request);
    const input = parseActivityCreateMutation(body);
    const activity = await runIdempotentCreate({
      mutationId,
      kind: "activity.create",
      payload: body,
      create: async (transaction) => {
        const attribution = await resolveTaskProjectAttribution(
          input.taskId,
          input.projectId,
          transaction
        );
        return transaction.activityEntry.create({
          data: {
            startedAt: input.startedAt,
            durationMinutes: input.durationMinutes,
            category: input.category,
            note: input.note,
            taskId: attribution.taskId,
            projectId: attribution.projectId,
            attributedProjectId: attribution.attributedProjectId
          }
        });
      }
    });

    return NextResponse.json(activity, { status: 201 });
  } catch (error) {
    return activityMutationErrorResponse(error, "Activity creation failed.");
  }
}
