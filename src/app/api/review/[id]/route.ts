import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ReviewHistoryRequestError,
  readPastReviewPeriod
} from "@/lib/review-history";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(await readPastReviewPeriod(prisma, id));
  } catch (error) {
    if (error instanceof ReviewHistoryRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("Review period could not be read.", error);
    return NextResponse.json(
      { error: "Review period could not be read.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
