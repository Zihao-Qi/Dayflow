import { appErrorConstructor } from "@/lib/error-compat";
import {
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";
import { evidenceErrors } from "@/lib/evidence-errors";
import type { ActivityReplaceMutation } from "@/lib/evidence-mutations";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import type { Prisma } from "@prisma/client";

export type ActivityPersistenceErrorCode =
  | "ACTIVITY_NOT_FOUND"
  | "FOCUS_ACTIVITY_PROTECTED"
  | "CONFLICT";

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const ActivityPersistenceError = appErrorConstructor(
  (
    message: string,
    code: ActivityPersistenceErrorCode,
    status: 404 | 409
  ) => new AppError({ status, message, code }),
  (error) => ["ACTIVITY_NOT_FOUND", "FOCUS_ACTIVITY_PROTECTED", "CONFLICT"].includes(error.code ?? "")
);
export type ActivityPersistenceError = AppError;

export async function replaceManualActivity(
  id: string,
  input: ActivityReplaceMutation
) {
  return prisma.$transaction((transaction) =>
    replaceManualActivityInTransaction(transaction, id, input)
  );
}

export async function replaceManualActivityInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  input: ActivityReplaceMutation
) {
  const existing = await transaction.activityEntry.findUnique({
    where: { id },
    select: {
      id: true,
      startedAt: true,
      origin: true,
      taskId: true,
      projectId: true,
      attributedProjectId: true,
      focusSessionId: true,
      updatedAt: true
    }
  });
  if (!existing) {
    throw new AppError(evidenceErrors.activityNotFound);
  }
  if (existing.origin !== "MANUAL" || existing.focusSessionId) {
    throw new AppError(evidenceErrors.focusEvidenceCannotBeEditedHere);
  }

  const relationshipsChanged =
    input.taskId !== existing.taskId ||
    input.projectId !== existing.projectId;
  const attribution = relationshipsChanged
    ? await resolveTaskProjectAttribution(
      input.taskId,
      input.projectId,
      transaction
    )
    : {
      taskId: existing.taskId,
      projectId: existing.projectId,
      attributedProjectId: existing.attributedProjectId
    };
  const startedAt = applyTimeToLocalDate(
    existing.startedAt,
    input.startTime
  );
  const updated = await transaction.activityEntry.updateMany({
    where: {
      id,
      origin: "MANUAL",
      focusSessionId: null,
      updatedAt: existing.updatedAt
    },
    data: {
      startedAt,
      durationMinutes: input.durationMinutes,
      category: input.category,
      note: input.note,
      taskId: attribution.taskId,
      projectId: attribution.projectId,
      attributedProjectId: attribution.attributedProjectId
    }
  });
  if (updated.count !== 1) {
    throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeUpdated);
  }
  const activity = await transaction.activityEntry.findUnique({
    where: { id }
  });
  if (!activity) {
    throw new AppError(evidenceErrors.theActivityChangedBeforeItCouldBeUpdated);
  }
  return activity;
}

function applyTimeToLocalDate(date: Date, startTime: string) {
  const startedAt = new Date(date);
  startedAt.setHours(
    Number(startTime.slice(0, 2)),
    Number(startTime.slice(3, 5)),
    0,
    0
  );
  return startedAt;
}
