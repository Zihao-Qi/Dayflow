import { appErrorResponse } from "@/lib/http-errors";
import { timeBlockErrors } from "@/lib/time-block-errors";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";

type TimeBlockMutationAction = "create" | "save" | "delete";

export function timeBlockMutationErrorResponse(
  error: unknown,
  action: TimeBlockMutationAction
) {
  if (error instanceof AppError) return appErrorResponse(error);

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return appErrorResponse(new AppError(timeBlockErrors.timeBlockNotFound));
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return appErrorResponse(new AppError(timeBlockErrors.theSelectedTaskCouldNotBeFound));
  }

  console.error(`Time Block ${action} failed.`, error);
  return appErrorResponse((action === "create" ? new AppError(timeBlockErrors.timeBlockCouldNotBeCreated) : (action === "delete" ? new AppError(timeBlockErrors.timeBlockCouldNotBeDeleted) : new AppError(timeBlockErrors.timeBlockCouldNotBeSaved))));
}
