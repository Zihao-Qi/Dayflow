import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ReviewMutationRequestError,
  assertCurrentReviewPeriod,
  parseReviewMutation,
  readReviewMutationBody
} from "@/lib/review-domain";

export async function PUT(request: NextRequest) {
  try {
    const body = await readReviewMutationBody(request);
    const input = parseReviewMutation(body);
    assertCurrentReviewPeriod(input);

    const review = await prisma.review.upsert({
      where: {
        periodStart_periodEnd: {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd
        }
      },
      create: input,
      update: {
        narrative: input.narrative,
        nextPeriodIntention: input.nextPeriodIntention
      }
    });

    return NextResponse.json({ ...review, persisted: true });
  } catch (error) {
    if (error instanceof ReviewMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: error.status }
      );
    }

    console.error("Review save failed.", error);
    return NextResponse.json(
      { error: "Review could not be saved.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
