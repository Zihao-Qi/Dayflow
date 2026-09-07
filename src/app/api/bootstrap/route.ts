import { clock } from "@/lib/time";
import { bootstrapErrors } from "@/lib/bootstrap-errors";
import { appErrorResponse } from "@/lib/http-errors";
import { getPrisma } from "@/lib/prisma";
import { readBootstrap } from "@/server/read-models/bootstrap";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export async function GET() {
  const now = clock.now();
  try {
    const payload = await getPrisma().$transaction(tx => readBootstrap(tx, now), { timeout: 60000 });
    return NextResponse.json(payload);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")
    ) {
      return appErrorResponse(new AppError(bootstrapErrors.migrationRequired));
    }

    console.error("Dayflow bootstrap failed.", error);
    return appErrorResponse(new AppError(bootstrapErrors.openFailed));
  }
}
