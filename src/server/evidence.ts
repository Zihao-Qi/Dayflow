import type { Prisma } from "@prisma/client";
import { appErrorResponse } from "@/lib/http-errors";
import { evidenceErrors } from "@/modules/evidence/domain/activity";
import { readActivityAttribution, translateActivityPersistenceError, type ActivityMutationAction } from "@/modules/evidence/services/activities";
import { AppError } from "@/shared/kernel/errors";

export { createActivity, replaceActivity, deleteActivity } from "@/modules/evidence/services/activities";
export { upsertDiary } from "@/modules/evidence/services/diary";
export { ActivityPersistenceError } from "@/modules/evidence/domain/activity";
export { replaceActivity as replaceManualActivityInTransaction } from "@/modules/evidence/services/activities";

/** Compatibility argument order for legacy focus and journal callers. */
export function resolveTaskProjectAttribution(taskValue: unknown, projectValue: unknown, database: Pick<Prisma.TransactionClient, "task" | "project">) {
  return readActivityAttribution(database, taskValue, projectValue);
}

export function evidenceMutationErrorResponse(error: unknown, action: ActivityMutationAction | "diary") {
  const translated = action === "diary" ? error : translateActivityPersistenceError(error, action);
  if (translated instanceof AppError) return appErrorResponse(translated);
  const fallback = { create: evidenceErrors.activityCreateFailed, replace: evidenceErrors.activityReplaceFailed,
    delete: evidenceErrors.activityCouldNotBeDeleted, diary: evidenceErrors.diaryCouldNotBeSaved };
  console.error(`Evidence ${action} failed.`, error);
  return appErrorResponse(new AppError(fallback[action]));
}

/** Compatibility entry point for the frozen Activity error-contract tests. */
export function activityMutationErrorResponse(
  error: unknown,
  logMessage: string,
  fallbackMessage: "Activity could not be saved." | "Activity could not be updated." = "Activity could not be saved."
) {
  const translated = translateActivityPersistenceError(error, fallbackMessage === "Activity could not be updated." ? "replace" : "create");
  if (translated instanceof AppError) return appErrorResponse(translated);
  console.error(logMessage, error);
  return appErrorResponse(new AppError(fallbackMessage === "Activity could not be updated." ? evidenceErrors.activityReplaceFailed : evidenceErrors.activityCreateFailed, error));
}

export { readDayActivities, readActivityCategories, readReviewActivities, readEarliestActivity } from "@/modules/evidence/services/activities";
export { readDiary, readReviewDiaries } from "@/modules/evidence/services/diary";
