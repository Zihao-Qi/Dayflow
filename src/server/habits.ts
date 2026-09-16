import { appErrorResponse } from "@/lib/http-errors";
import { evidenceErrors } from "@/modules/evidence/domain/activity";
import {
  translateHabitPersistenceError,
  type HabitMutationAction
} from "@/modules/evidence/services/habits";
import { AppError } from "@/shared/kernel/errors";

export {
  createHabit,
  readHabit,
  readActiveHabits,
  updateHabit,
  archiveHabit,
  upsertCheckIn,
  readCheckIns,
  readHabitCheckIns
} from "@/modules/evidence/services/habits";

export function habitErrorResponse(error: unknown, action: HabitMutationAction) {
  // The same translation covers failures raised while committing.
  const translated = translateHabitPersistenceError(error);
  if (translated instanceof AppError) return appErrorResponse(translated);
  const fallback = {
    load: evidenceErrors.habitsCouldNotBeLoaded,
    save: evidenceErrors.habitCouldNotBeSaved,
    "check-in": evidenceErrors.checkInCouldNotBeSaved
  };
  console.error(`Habit ${action} failed.`, error);
  return appErrorResponse(new AppError(fallback[action], error));
}
