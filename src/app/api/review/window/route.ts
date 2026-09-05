import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { reviewErrors } from "@/lib/review-errors";
import {
  readReviewWindow
} from "@/lib/review-history";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readReviewWindow(prisma, request.nextUrl.searchParams)
    );
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("Review Window could not be read.", error);
    return appErrorResponse(new AppError(reviewErrors.reviewWindowCouldNotBeRead));
  }
}
