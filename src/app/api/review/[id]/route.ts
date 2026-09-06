import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { reviewErrors } from "@/lib/review-errors";
import {
  isReviewIdentifier,
  readPastReviewPeriod
} from "@/lib/review-history";
import { AppError } from "@/shared/kernel/errors";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const now = clock.now();
  try {
    const { id } = await params;
    if (!isReviewIdentifier(id)) throw new AppError(reviewErrors.thatReviewIdentifierIsNotValid);
    return NextResponse.json(await prisma.$transaction(tx => readPastReviewPeriod(tx, id, now)));
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review period could not be read.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewPeriodCouldNotBeRead));
  }
}
