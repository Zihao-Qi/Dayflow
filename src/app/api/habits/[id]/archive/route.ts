import { clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { evidenceErrors } from "@/modules/evidence/domain/activity";
import { parseWorkflowId } from "@/lib/workflow-mutations";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { archiveHabit, habitErrorResponse } from "@/server/habits";

type Params = { params: Promise<{ id: string }> };

/** Archiving replaces deletion: the definition is retired, its record is kept. */
export async function POST(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const id = parseWorkflowId(
      (await params).id,
      "id",
      evidenceErrors.habitIdentifierIsInvalid.message
    );
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const habit = await runOnce({
      mutationId,
      kind: "habit.archive",
      payload: { habitId: id },
      create: (tx) => archiveHabit(tx, id, now)
    });
    return NextResponse.json(habit);
  } catch (error) {
    return habitErrorResponse(error, "save");
  }
}
