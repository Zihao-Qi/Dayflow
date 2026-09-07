import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { getPrisma } from "@/lib/prisma";
import { reviewErrors } from "@/lib/review-errors";
import {
  loadReviewWindow
} from "@/server/review";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const now = clock.now();
  try {
    return NextResponse.json(
      await loadReviewWindow(getPrisma(), request.nextUrl.searchParams, now)
    );
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review Window could not be read.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewWindowCouldNotBeRead));
  }
}
