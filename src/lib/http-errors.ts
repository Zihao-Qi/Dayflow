import { AppError } from "@/shared/kernel/errors";
import { NextResponse } from "next/server";

/** Emit only declared wire properties, preserving their catalog order. */
export function serializeAppError(error: AppError) {
  const body: { error?: string; code?: string; field?: string; requiresConfirmation?: true } = {};
  for (const key of Object.keys(error.spec)) {
    if (key === "message") body.error = error.spec.message;
    else if (key === "code" && error.spec.code !== undefined) body.code = error.spec.code;
    else if (key === "field" && error.spec.field !== undefined) body.field = error.spec.field;
    else if (key === "requiresConfirmation" && error.spec.requiresConfirmation !== undefined) {
      body.requiresConfirmation = error.spec.requiresConfirmation;
    }
  }
  return { status: error.spec.status, body };
}

export function appErrorResponse(error: AppError, noStore = false) {
  const { status, body } = serializeAppError(error);
  return NextResponse.json(body, {
    status,
    ...(noStore ? { headers: { "Cache-Control": "no-store" } } : {})
  });
}
