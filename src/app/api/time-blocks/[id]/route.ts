import { getPrisma } from "@/lib/prisma";
import { clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteTimeBlock,
  replaceTimeBlock,
  timeBlockMutationErrorResponse
} from "@/server/time-blocks";
import {
  parseTimeBlockDraftStructure,
  parseTimeBlockPathId,
  readTimeBlockMutationBody
} from "@/modules/planning/domain/time-block";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    const body = await readTimeBlockMutationBody(request);
    // Replacement validates date transitions against the stored block inside
    // the persistence transaction, so unchanged past dates remain correctable.
    // The service samples the clock after that read, so a day that ends
    // mid-request is still caught.
    const input = parseTimeBlockDraftStructure(body);
    const timeBlock = await getPrisma().$transaction((tx) => replaceTimeBlock(tx, id, input, clock));
    return NextResponse.json(timeBlock);
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    const result = await getPrisma().$transaction((tx) => deleteTimeBlock(tx, id));
    return NextResponse.json(result);
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "delete");
  }
}
