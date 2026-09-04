import { prisma } from "@/lib/prisma";
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
  const now = clock.now();
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    const body = await readTimeBlockMutationBody(request);
    // Replacement validates date transitions against the stored block inside
    // the persistence transaction, so unchanged past dates remain correctable.
    const input = parseTimeBlockDraftStructure(body);
    const timeBlock = await prisma.$transaction((tx) => replaceTimeBlock(tx, id, input, now));
    return NextResponse.json(timeBlock);
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "save");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  try {
    const id = parseTimeBlockPathId(rawId);
    const result = await prisma.$transaction((tx) => deleteTimeBlock(tx, id));
    return NextResponse.json(result);
  } catch (error) {
    return timeBlockMutationErrorResponse(error, "delete");
  }
}
