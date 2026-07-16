import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ids = Array.isArray(body.ids) ? body.ids : [];

  await prisma.$transaction(
    ids.map((id: string, index: number) =>
      prisma.task.update({ where: { id }, data: { sortOrder: index + 1 } })
    )
  );

  return NextResponse.json({ ok: true });
}
