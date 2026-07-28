import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const activity = await prisma.activityEntry.findUnique({
    where: { id },
    select: { focusSessionId: true, origin: true }
  });
  if (!activity) {
    return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  }
  if (activity.focusSessionId || activity.origin === "FOCUS") {
    return NextResponse.json(
      { error: "Focus evidence cannot be deleted." },
      { status: 409 }
    );
  }
  await prisma.activityEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
