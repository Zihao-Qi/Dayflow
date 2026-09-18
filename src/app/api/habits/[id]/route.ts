import { NextRequest, NextResponse } from "next/server";
import { evidenceErrors, readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { parseHabitPatchMutation } from "@/modules/evidence/domain/habit";
import { parseWorkflowId } from "@/lib/workflow-mutations";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { updateHabit, habitErrorResponse } from "@/server/habits";

type Params = { params: Promise<{ id: string }> };

// There is no DELETE. A Habit is archived so its Check-ins survive; see
// docs/specs/CHECK_INS_V1.md.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const id = parseWorkflowId(
      (await params).id,
      "id",
      evidenceErrors.habitIdentifierIsInvalid.message
    );
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const body = await readEvidenceMutationBody(request);
    const patch = parseHabitPatchMutation(body);
    const habit = await runOnce({
      mutationId,
      kind: "habit.patch",
      payload: { ...body, habitId: id },
      create: (tx) => updateHabit(tx, id, patch)
    });
    return NextResponse.json(habit);
  } catch (error) {
    return habitErrorResponse(error, "save");
  }
}
