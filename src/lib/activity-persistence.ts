import type { Prisma } from "@prisma/client";
import {
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";
import type { ActivityReplaceMutation } from "@/lib/evidence-mutations";
import { prisma } from "@/lib/prisma";

export type ActivityPersistenceErrorCode =
  | "ACTIVITY_NOT_FOUND"
  | "FOCUS_ACTIVITY_PROTECTED"
  | "CONFLICT";

export class ActivityPersistenceError extends Error {
  constructor(
    message: string,
    readonly code: ActivityPersistenceErrorCode,
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = "ActivityPersistenceError";
  }
}

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
    throw new ActivityPersistenceError(
      "Activity not found.",
      "ACTIVITY_NOT_FOUND",
      404
    );
  }
  if (existing.origin !== "MANUAL" || existing.focusSessionId) {
    throw new ActivityPersistenceError(
      "Focus evidence cannot be edited here.",
      "FOCUS_ACTIVITY_PROTECTED",
      409
    );
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
    throw new ActivityPersistenceError(
      "The Activity changed before it could be updated.",
      "CONFLICT",
      409
    );
  }
  const activity = await transaction.activityEntry.findUnique({
    where: { id }
  });
  if (!activity) {
    throw new ActivityPersistenceError(
      "The Activity changed before it could be updated.",
      "CONFLICT",
      409
    );
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
