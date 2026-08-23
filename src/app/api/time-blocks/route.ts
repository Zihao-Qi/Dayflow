import { NextRequest, NextResponse } from "next/server";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { timeBlockMutationErrorResponse } from "@/lib/time-block-http";
import { createTimeBlock } from "@/lib/time-block-persistence";
import {
  assertTimeBlockIsNotPast,
  parseTimeBlockDraftStructure,
  readTimeBlockMutationBody
} from "@/lib/time-blocks";

export async function POST(request: NextRequest) {
  try {
    const body = await readTimeBlockMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseTimeBlockDraftStructure(body);
    const timeBlock = await runIdempotentCreate({
      mutationId,
      kind: "time-block.create",
      payload: body,
      create: (transaction) => {
        assertTimeBlockIsNotPast(input);
        return createTimeBlock(input, transaction);
      }
    });
    return NextResponse.json(timeBlock, { status: 201 });
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "create");
  }
}
