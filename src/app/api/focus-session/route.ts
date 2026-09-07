import { clock } from "@/lib/time";
import { getPrisma } from "@/lib/prisma";
import { readWorkflowMutationBody } from "@/lib/workflow-mutations";
import { parseFocusSessionStartMutation } from "@/modules/focus/domain/session";
import { readSnapshot, startSession, focusErrorResponse } from "@/server/focus";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { NextRequest, NextResponse } from "next/server";

// SQLite allows one writer at a time. Queue local starts so competing Prisma
// transactions reach the active-session guard without timing out; the unique
// activeKey remains the database-level invariant across processes.
const globalForFocusSessionStart = globalThis as typeof globalThis & {
  dayflowFocusSessionStartQueue?: Promise<void>;
};

export async function GET() {
  const now = clock.now();
  try { return NextResponse.json(await readSnapshot(getPrisma(), now)); }
  catch (error) { return focusErrorResponse(error, "read"); }
}

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readWorkflowMutationBody(request);
    const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
    const input = parseFocusSessionStartMutation(body);
    const result = await serializeFocusSessionStart(() =>
      runOnce({
        mutationId,
        kind: "focus-session.start",
        payload: input,
        create: async (tx) => {
          const session = await startSession(tx, input, clock.now());
          return { session, snapshot: await readSnapshot(tx, now) };
        }
      })
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return focusErrorResponse(error, "start"); }
}

function serializeFocusSessionStart<T>(operation: () => Promise<T>) {
  const previous =
    globalForFocusSessionStart.dayflowFocusSessionStartQueue ??
    Promise.resolve();
  const result = previous.then(operation);
  globalForFocusSessionStart.dayflowFocusSessionStartQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
