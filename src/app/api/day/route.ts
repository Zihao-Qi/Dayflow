import { dayErrors } from "@/lib/day-errors";
import {
  DAY_VIEW_FORWARD_WEEKS,
  assertViewedDayOnOrAfter,
  earliestRecordedDay,
  parseViewedDay,
  readViewedDay,
  resolveEarliestNavigableDayKey
} from "@/lib/day-view";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { date } = parseViewedDay(request.nextUrl.searchParams);
    const earliestDayKey = resolveEarliestNavigableDayKey(
      await earliestRecordedDay(prisma)
    );
    assertViewedDayOnOrAfter(date, earliestDayKey);
    const day = await readViewedDay(prisma, date);
    return NextResponse.json({
      ...day,
      earliestDayKey,
      forwardWeeks: DAY_VIEW_FORWARD_WEEKS
    });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Day could not be read.", error);
    return appErrorResponse(new AppError(dayErrors.thatDayCouldNotBeRead));
  }
}
