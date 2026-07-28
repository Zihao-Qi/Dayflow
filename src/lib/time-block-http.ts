import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { IdempotentMutationError } from "@/lib/idempotent-mutations";
import { TimeBlockError } from "@/lib/time-blocks";

type TimeBlockMutationAction = "create" | "save" | "delete";

export function timeBlockMutationErrorResponse(
  error: unknown,
  action: TimeBlockMutationAction
) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (error instanceof TimeBlockError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {})
      },
      { status: error.status }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return NextResponse.json(
      { error: "Time Block not found.", code: "NOT_FOUND", field: "id" },
      { status: 404 }
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: "The selected Task could not be found.",
        code: "RELATIONSHIP_NOT_FOUND",
        field: "taskId"
      },
      { status: 404 }
    );
  }

  console.error(`Time Block ${action} failed.`, error);
  return NextResponse.json(
    {
      error:
        action === "create"
          ? "Time Block could not be created."
          : action === "delete"
            ? "Time Block could not be deleted."
            : "Time Block could not be saved.",
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}
