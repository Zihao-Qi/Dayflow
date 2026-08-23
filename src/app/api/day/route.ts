import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DAY_VIEW_FORWARD_WEEKS,
  DayViewRequestError,
  earliestRecordedDay,
  parseViewedDay,
  readViewedDay
} from "@/lib/day-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { date } = parseViewedDay(request.nextUrl.searchParams);
    const [day, earliestDayKey] = await Promise.all([
      readViewedDay(prisma, date),
      earliestRecordedDay(prisma)
    ]);
    return NextResponse.json({
      ...day,
      earliestDayKey,
      forwardWeeks: DAY_VIEW_FORWARD_WEEKS
    });
  } catch (error) {
    if (error instanceof DayViewRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: error.status }
      );
    }

    console.error("Day could not be read.", error);
    return NextResponse.json(
      { error: "That day could not be read.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
