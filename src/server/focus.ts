import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clock } from "@/lib/time";
import { appErrorResponse } from "@/lib/http-errors";
import { focusErrors, type EnrichmentDetails, type StartSessionInput } from "@/modules/focus/domain/session";
import { readSnapshot, startSession, transitionSession, enrichSession, translateFocusPersistenceError } from "@/modules/focus/services/sessions";
import { AppError } from "@/shared/kernel/errors";

export { readSnapshot, startSession, transitionSession, enrichSession };
export { readSnapshot as getFocusSnapshot };

/** Legacy callers keep their argument order while all service writes require tx first. */
export function startFocusSession(input: StartSessionInput, tx: Prisma.TransactionClient) {
  return startSession(tx, input, clock.now());
}

export function transitionFocusSession(id: string, action: string, input: EnrichmentDetails = {}, now: Date) {
  return prisma.$transaction(tx => action === "enrich" || action === "record"
    ? enrichSession(tx, id, input, now)
    : transitionSession(tx, id, action, now));
}

export function focusErrorResponse(error: unknown, action: "read" | "start" | "save") {
  const translated = action === "read" ? error : translateFocusPersistenceError(error, action);
  // GET has always hidden all errors behind its snapshot-load fallback.
  if (action !== "read" && translated instanceof AppError) return appErrorResponse(translated);
  const fallback = { read: focusErrors.focusTimerCouldNotBeLoaded, start: focusErrors.focusTimerCouldNotBeStarted, save: focusErrors.focusTimerCouldNotBeSaved };
  console.error(fallback[action].message, error);
  return appErrorResponse(new AppError(fallback[action], error));
}
