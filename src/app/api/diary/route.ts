import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const date = body.date ? parseLocalDate(body.date) : startOfLocalDay();
  if (!date) {
    return NextResponse.json(
      { error: "Diary date must be a valid calendar date." },
      { status: 400 }
    );
  }
  const mood = parseRating(body.mood, "Mood");
  if (typeof mood !== "number") return mood;
  const energy = parseRating(body.energy, "Energy");
  if (typeof energy !== "number") return energy;

  const diary = await prisma.diaryEntry.upsert({
    where: { date },
    create: {
      date,
      content: body.content ?? "",
      reflection: body.reflection ?? "",
      mood,
      energy
    },
    update: {
      content: body.content ?? "",
      reflection: body.reflection ?? "",
      mood,
      energy
    }
  });

  return NextResponse.json({ ...diary, persisted: true });
}

function parseRating(value: unknown, label: string) {
  const rating = Number(value ?? 3);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: `${label} must be a whole number from 1 to 5.` },
      { status: 400 }
    );
  }
  return rating;
}
