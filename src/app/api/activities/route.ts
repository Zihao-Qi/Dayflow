import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  EvidenceAttributionError,
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";
import {
  EvidenceMutationRequestError,
  parseActivityCreateMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";
import {
  IdempotentMutationError,
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
    return activityMutationErrorResponse(error);
  }
}

function activityMutationErrorResponse(error: unknown) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (error instanceof EvidenceMutationRequestError) {
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
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "The linked Activity relationship is no longer available.",
        code: "RELATIONSHIP_CONFLICT"
      },
      { status: 409 }
    );
  }

  console.error("Activity creation failed.", error);
  return NextResponse.json(
    { error: "Activity could not be saved.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
