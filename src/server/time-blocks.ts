// API entry point: Rule 1 keeps app imports out of module services.
import { appErrorResponse } from "@/lib/http-errors";
import { timeBlockErrors } from "@/modules/planning/domain/time-block";
import { translateTimeBlockPersistenceError } from "@/modules/planning/services/time-blocks";
import { AppError } from "@/shared/kernel/errors";

export {
  createTimeBlock,
  replaceTimeBlock,
  deleteTimeBlock,
  readTimeBlocks
} from "@/modules/planning/services/time-blocks";

export function timeBlockMutationErrorResponse(
  error: unknown,
  action: "create" | "save" | "delete"
) {
  const translated = translateTimeBlockPersistenceError(error);
  if (translated instanceof AppError) return appErrorResponse(translated);
  console.error(`Time Block ${action} failed.`, error);
  const spec = action === "create" ? timeBlockErrors.timeBlockCouldNotBeCreated
    : action === "delete" ? timeBlockErrors.timeBlockCouldNotBeDeleted
      : timeBlockErrors.timeBlockCouldNotBeSaved;
  return appErrorResponse(new AppError(spec));
}
