import { saveReview } from "@/server/review";
import { clock, calendar } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import {
  parseReviewMutation,
  readReviewMutationBody
} from "@/lib/review-domain";
import { reviewErrors } from "@/lib/review-errors";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readReviewMutationBody(request);
    const input = parseReviewMutation(body, calendar);
    return NextResponse.json(await saveReview(prisma, input, now));
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review save failed.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewCouldNotBeSaved));
  }
}
