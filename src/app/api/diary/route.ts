import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfLocalDay } from "@/lib/dates";

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const date = body.date ? startOfLocalDay(new Date(body.date)) : startOfLocalDay();

  const diary = await prisma.diaryEntry.upsert({
    where: { date },
    create: {
      date,
      content: body.content ?? "",
      reflection: body.reflection ?? "",
      mood: Number(body.mood ?? 3),
      energy: Number(body.energy ?? 3)
    },
    update: {
      content: body.content ?? "",
      reflection: body.reflection ?? "",
      mood: Number(body.mood ?? 3),
      energy: Number(body.energy ?? 3)
    }
  });

  return NextResponse.json(diary);
}
