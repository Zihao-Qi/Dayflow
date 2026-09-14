import { clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { evidenceErrors } from "@/modules/evidence/domain/activity";
import { parseWorkflowId } from "@/lib/workflow-mutations";
import { runInTransaction } from "@/server/prisma/client";
import { archiveHabit, habitErrorResponse } from "@/server/habits";

type Params = { params: Promise<{ id: string }> };

/** Archiving replaces deletion: the definition is retired, its record is kept. */
export async function POST(_request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const id = parseWorkflowId(
      (await params).id,
      "id",
      evidenceErrors.habitIdentifierIsInvalid.message
    );
    const habit = await runInTransaction((tx) => archiveHabit(tx, id, now));
    return NextResponse.json(habit);
  } catch (error) {
    return habitErrorResponse(error, "save");
  }
}
