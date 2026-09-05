import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { reviewErrors } from "@/lib/review-errors";
import {
  parseReviewWindowRequest,
  readResolvedReviewWindow
} from "@/lib/review-history";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const now = clock.now();
  try {
    const window = parseReviewWindowRequest(request.nextUrl.searchParams, now);
    return NextResponse.json(
      await prisma.$transaction(tx => readResolvedReviewWindow(tx, window))
    );
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review Window could not be read.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewWindowCouldNotBeRead));
  }
}
