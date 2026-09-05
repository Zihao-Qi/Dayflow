import { clock } from "@/lib/time";
import { focusErrors } from "@/lib/focus-errors";
import {
  getFocusSnapshot,
  startFocusSession
} from "@/lib/focus-sessions";
import { appErrorResponse } from "@/lib/http-errors";
import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import { getPrisma } from "@/lib/prisma";
import {
  parseFocusSessionStartMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// SQLite allows one writer at a time. Queue local starts so competing Prisma
// transactions reach the active-session guard without timing out; the unique
// activeKey remains the database-level invariant across processes.
const globalForFocusSessionStart = globalThis as typeof globalThis & {
  dayflowFocusSessionStartQueue?: Promise<void>;
};

export async function GET() {
  const now = clock.now();
  try {
    return NextResponse.json(await getFocusSnapshot(getPrisma(), now));
  } catch (error) {
    console.error("Focus snapshot load failed.", error);
    return appErrorResponse(new AppError(focusErrors.focusTimerCouldNotBeLoaded));
  }
}

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const body = await readWorkflowMutationBody(request);
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const input = parseFocusSessionStartMutation(body);
    const result = await serializeFocusSessionStart(() =>
      runIdempotentCreate({
        mutationId,
        kind: "focus-session.start",
        payload: input,
        create: async (transaction) => {
          const session = await startFocusSession(input, transaction);
          return {
            session,
            snapshot: await getFocusSnapshot(transaction, now)
          };
        }
      })
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);



    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return appErrorResponse(new AppError(focusErrors.aSelectedFocusRelationshipChangedBeforeTheTimerStarted));
    }

    console.error("Focus session start failed.", error);
    return appErrorResponse(new AppError(focusErrors.focusTimerCouldNotBeStarted));
  }
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
