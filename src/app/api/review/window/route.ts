import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  readReviewWindow,
  ReviewHistoryRequestError
} from "@/lib/review-history";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readReviewWindow(prisma, request.nextUrl.searchParams)
    );
  } catch (error) {
    if (error instanceof ReviewHistoryRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("Review Window could not be read.", error);
    return NextResponse.json(
      { error: "Review Window could not be read.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
