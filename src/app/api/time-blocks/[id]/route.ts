import { NextRequest, NextResponse } from "next/server";
import { timeBlockMutationErrorResponse } from "@/lib/time-block-http";
import {
  deleteTimeBlock,
  replaceTimeBlock
} from "@/lib/time-block-persistence";
import {
  parseTimeBlockDraftStructure,
  parseTimeBlockPathId,
  readTimeBlockMutationBody
} from "@/lib/time-blocks";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    const body = await readTimeBlockMutationBody(request);
    // Replacing an existing past block is a correction, not a new plan.
    // Creation keeps the not-past guard; replacement keeps structural and
    // relationship validation without rejecting the block's stored day.
    const input = parseTimeBlockDraftStructure(body);
    return NextResponse.json(await replaceTimeBlock(id, input));
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    return NextResponse.json(await deleteTimeBlock(id));
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "delete");
  }
}
