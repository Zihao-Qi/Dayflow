import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const latest = await prisma.taskScheduleChange.findFirst({
    where: { taskId: id },
    orderBy: { createdAt: "desc" }
  });

  if (!latest) {
    return NextResponse.json({ error: "There is no schedule change to undo." }, { status: 404 });
  }

  const task = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.task.update({
      where: { id },
      data: { date: latest.previousDate }
    });
    await transaction.taskScheduleChange.delete({ where: { id: latest.id } });
    return updated;
  });

  return NextResponse.json(task);
}
