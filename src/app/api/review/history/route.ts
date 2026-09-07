import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { getPrisma } from "@/lib/prisma";
import { reviewErrors } from "@/lib/review-errors";
import {
  readReviewHistoryPage
} from "@/server/review";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const now = clock.now();
  try {
    const page = await readReviewHistoryPage(
      getPrisma(),
      request.nextUrl.searchParams, now
    );
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review history could not be read.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewHistoryCouldNotBeRead));
  }
}
