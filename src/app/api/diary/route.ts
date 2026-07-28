import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EvidenceMutationRequestError,
  parseDiaryUpsertMutation,
  readEvidenceMutationBody
} from "@/lib/evidence-mutations";

export async function PUT(request: NextRequest) {
  try {
    const body = await readEvidenceMutationBody(request);
    const input = parseDiaryUpsertMutation(body);
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
    if (error instanceof EvidenceMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }

    console.error("Diary save failed.", error);
    return NextResponse.json(
      { error: "Diary could not be saved.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
