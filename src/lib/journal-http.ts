import { appErrorResponse } from "@/lib/http-errors";
import { journalAppError } from "@/lib/journal-errors";
import { AppError, type ErrorSpec } from "@/shared/kernel/errors";

export function journalErrorResponse(error: unknown, fallback: ErrorSpec) {
  if (error instanceof AppError) return appErrorResponse(journalAppError(error));
  console.error(fallback.message, error);
  return appErrorResponse(new AppError(fallback, error));
}
