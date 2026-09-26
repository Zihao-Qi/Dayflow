import { calendar, clock } from "@/lib/time";
import { readHabitHistory, habitErrorResponse } from "@/server/habits";
import { runInTransaction } from "@/server/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

// The window is the server calendar's today-7..today. A query cannot widen it.
export async function GET(_request: NextRequest) {
  const now = clock.now();
  try {
    const history = await runInTransaction((tx) => readHabitHistory(tx, now, calendar));
    return NextResponse.json(history, noStore);
  } catch (error) {
    return habitErrorResponse(error, "load");
  }
}
