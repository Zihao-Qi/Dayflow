import { clock } from "@/lib/time";
import { evidenceErrors } from "@/lib/evidence-errors";
import {
  parseDiaryUpsertMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readEvidenceMutationBody(request);
    const input = parseDiaryUpsertMutation(body, now);
    const diary = await prisma.$transaction((transaction) =>
      transaction.diaryEntry.upsert({
        where: { date: input.date },
        create: input,
        update: {
          content: input.content,
          reflection: input.reflection,
          mood: input.mood,
          energy: input.energy
        }
      })
    );

    return NextResponse.json({ ...diary, persisted: true });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Diary save failed.", error);
    return appErrorResponse(new AppError(evidenceErrors.diaryCouldNotBeSaved));
  }
}
