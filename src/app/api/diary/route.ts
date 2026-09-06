import { clock } from "@/lib/time";
import { readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { parseDiaryUpsertMutation } from "@/modules/evidence/domain/diary";
import { prisma } from "@/lib/prisma";
import { upsertDiary, evidenceMutationErrorResponse } from "@/server/evidence";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  const now = clock.now();
  try {
    const input = parseDiaryUpsertMutation(await readEvidenceMutationBody(request), now);
    const diary = await prisma.$transaction(tx => upsertDiary(tx, input));
    return NextResponse.json({ ...diary, persisted: true });
  } catch (error) {
    return evidenceMutationErrorResponse(error, "diary");
  }
}
