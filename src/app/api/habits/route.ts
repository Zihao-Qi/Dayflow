import { NextRequest, NextResponse } from "next/server";
import { readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { parseHabitCreateMutation } from "@/modules/evidence/domain/habit";
import { runInTransaction } from "@/server/prisma/client";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { createHabit, readActiveHabits, habitErrorResponse } from "@/server/habits";

export async function GET() {
  try {
    return NextResponse.json(await runInTransaction((tx) => readActiveHabits(tx)));
  } catch (error) {
    return habitErrorResponse(error, "load");
  }
}

export async function POST(request: NextRequest) {
  try {
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const body = await readEvidenceMutationBody(request);
    // Validate before storage is opened, so an invalid Habit is refused even
    // when the database is unavailable.
    const input = parseHabitCreateMutation(body);
    const habit = await runOnce({
      mutationId,
      kind: "habit.create",
      payload: body,
      create: (tx) => createHabit(tx, input)
    });
    return NextResponse.json(habit, { status: 201 });
  } catch (error) {
    return habitErrorResponse(error, "save");
  }
}
