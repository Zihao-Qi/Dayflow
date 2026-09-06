import { clock } from "@/lib/time";
import { parseTaskCreateMutation, readTaskMutationBody } from "@/modules/planning/domain/task";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { createTask, taskMutationErrorResponse } from "@/server/tasks";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readTaskMutationBody(request);
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const input = parseTaskCreateMutation(body, now);
    const task = await runOnce({
      mutationId, kind: "task.create", payload: body,
      create: (tx) => createTask(tx, input)
    });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return taskMutationErrorResponse(error, "create");
  }
}
