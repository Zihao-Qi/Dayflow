import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  FocusSessionConflictError,
  FocusSessionError,
  FocusSessionNotFoundError,
  getFocusSnapshot,
  startFocusSession
} from "@/lib/focus-sessions";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  WorkflowMutationRequestError,
  parseFocusSessionStartMutation,
  readWorkflowMutationBody
} from "@/lib/workflow-mutations";

// SQLite allows one writer at a time. Queue local starts so competing Prisma
// transactions reach the active-session guard without timing out; the unique
// activeKey remains the database-level invariant across processes.
const globalForFocusSessionStart = globalThis as typeof globalThis & {
  dayflowFocusSessionStartQueue?: Promise<void>;
};

export async function GET() {
  try {
    return NextResponse.json(await getFocusSnapshot());
  } catch (error) {
    console.error("Focus snapshot load failed.", error);
    return NextResponse.json(
      { error: "Focus timer could not be loaded.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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
            snapshot: await getFocusSnapshot(transaction)
          };
        }
      })
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotentMutationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof WorkflowMutationRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, field: error.field },
        { status: 400 }
      );
    }
    if (error instanceof FocusSessionNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    if (error instanceof FocusSessionError) {
      return NextResponse.json(
        {
          error: error.message,
          code:
            error instanceof FocusSessionConflictError
              ? "CONFLICT"
              : "VALIDATION_ERROR"
        },
        { status: error instanceof FocusSessionConflictError ? 409 : 400 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        {
          error: "A selected Focus relationship changed before the timer started.",
          code: "CONFLICT"
        },
        { status: 409 }
      );
    }

    console.error("Focus session start failed.", error);
    return NextResponse.json(
      { error: "Focus timer could not be started.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
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
