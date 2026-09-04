import { clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import {
  parseMutationId,
  runOnce
} from "@/server/prisma/run-once";
import { createTimeBlock, timeBlockMutationErrorResponse } from "@/server/time-blocks";
import {
  parseTimeBlockDraftStructure,
  readTimeBlockMutationBody
} from "@/modules/planning/domain/time-block";

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readTimeBlockMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseTimeBlockDraftStructure(body);
    const timeBlock = await runOnce({
      mutationId,
      kind: "time-block.create",
      payload: body,
      create: (tx) => createTimeBlock(tx, input, now)
    });
    return NextResponse.json(timeBlock, { status: 201 });
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "create");
  }
}
