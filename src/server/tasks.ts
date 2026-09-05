import { appErrorResponse } from "@/lib/http-errors";
import { taskErrors } from "@/modules/planning/domain/task";
import { translateTaskPersistenceError, type TaskMutationAction } from "@/modules/planning/services/tasks";
import { AppError } from "@/shared/kernel/errors";

export { createTask, updateTask, deleteTask, reorderTasks, undoSchedule, readTask, readDayTasks } from "@/modules/planning/services/tasks";

export function taskMutationErrorResponse(error: unknown, action: TaskMutationAction) {
  const translated = translateTaskPersistenceError(error, action);
  if (translated instanceof AppError) return appErrorResponse(translated);
  const fallback = {
    create: taskErrors.taskCouldNotBeCreated,
    save: taskErrors.taskCouldNotBeSaved,
    delete: taskErrors.taskCouldNotBeDeleted,
    reorder: taskErrors.taskOrderCouldNotBeSaved,
    undo: taskErrors.theScheduleChangeCouldNotBeUndone
  };
  console.error(`Task ${action} failed.`, error);
  return appErrorResponse(new AppError(fallback[action]));
}
