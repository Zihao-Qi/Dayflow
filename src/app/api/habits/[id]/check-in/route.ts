import { calendar, clock } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { evidenceErrors, readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { parseCheckInMutation, parseHistoryCheckInDate } from "@/modules/evidence/domain/habit";
import { parseWorkflowId } from "@/lib/workflow-mutations";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { readHabit, readHabitCheckInOnDate, upsertCheckIn, habitErrorResponse } from "@/server/habits";
import { runInTransaction } from "@/server/prisma/client";
import { AppError } from "@/shared/kernel/errors";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const id = parseWorkflowId(
      (await params).id,
      "id",
      evidenceErrors.habitIdentifierIsInvalid.message
    );
    // Date shape is refused before storage opens, and never replaced with today.
    const date = parseHistoryCheckInDate(request.nextUrl.searchParams, now);
    const body = await runInTransaction((tx) =>
      readHabitCheckInOnDate(tx, id, date, now, calendar)
    );
    return NextResponse.json(body, noStore);
  } catch (error) {
    return habitErrorResponse(error, "load");
  }
}

/**
 * Storage is an upsert keyed by (habitId, date), but check-in writes follow
 * CHECK_INS_V1's mutation-ID convention so clients can distinguish replays,
 * detect mutation-ID reuse conflicts across differing requests, and receive
 * idempotent receipts.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const id = parseWorkflowId(
      (await params).id,
      "id",
      evidenceErrors.habitIdentifierIsInvalid.message
    );
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const body = await readEvidenceMutationBody(request);
    // The backfill window is enforced here, before storage is opened.
    const input = parseCheckInMutation(body, now);
    const checkIn = await runOnce({
      mutationId,
      kind: "habit.check-in",
      payload: { ...body, habitId: id },
      create: async (tx) => {
        // Without this an unknown Habit would surface as a foreign-key failure
        // rather than as "Habit not found".
        if (!(await readHabit(tx, id))) {
          throw new AppError(evidenceErrors.habitNotFound);
        }
        return upsertCheckIn(tx, id, input);
      }
    });
    return NextResponse.json(checkIn);
  } catch (error) {
    return habitErrorResponse(error, "check-in");
  }
}
