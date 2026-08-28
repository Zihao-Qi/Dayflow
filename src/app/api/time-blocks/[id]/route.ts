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
    // Replacement validates date transitions against the stored block inside
    // the persistence transaction, so unchanged past dates remain correctable.
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
