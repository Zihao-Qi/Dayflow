import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ReviewHistoryRequestError,
  readReviewHistoryPage
} from "@/lib/review-history";

export async function GET(request: NextRequest) {
  try {
    const page = await readReviewHistoryPage(
      prisma,
      request.nextUrl.searchParams
    );
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof ReviewHistoryRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("Review history could not be read.", error);
    return NextResponse.json(
      { error: "Review history could not be read.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
