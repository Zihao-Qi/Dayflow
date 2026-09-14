import { clock } from "@/lib/time";
import { getPrisma } from "@/lib/prisma";
import { readWorkflowMutationBody } from "@/lib/workflow-mutations";
import { parseFocusSessionStartMutation } from "@/modules/focus/domain/session";
import { readSnapshot, startSession, focusErrorResponse } from "@/server/focus";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const now = clock.now();
  try { return NextResponse.json(await readSnapshot(getPrisma(), now)); }
  catch (error) { return focusErrorResponse(error, "read"); }
}

// Starts were once queued here, by this route alone, so competing starts
// reached the active-session guard without timing out. The transaction module
// now queues every root, which covers this one; wrapping it again would hold a
// permit while `runOnce` waited for the same permit. The unique activeKey
// remains the database-level invariant across processes.
export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readWorkflowMutationBody(request);
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const input = parseFocusSessionStartMutation(body);
    const result = await runOnce({
      mutationId,
      kind: "focus-session.start",
      payload: input,
      create: async (tx) => {
        const session = await startSession(tx, input, clock.now());
        return { session, snapshot: await readSnapshot(tx, now) };
      }
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return focusErrorResponse(error, "start"); }
}
