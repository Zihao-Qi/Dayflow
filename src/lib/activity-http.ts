import { evidenceErrors } from "@/lib/evidence-errors";
import { appErrorResponse } from "@/lib/http-errors";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";

export function activityMutationErrorResponse(
  error: unknown,
  logMessage: string,
  fallbackMessage: "Activity could not be saved." | "Activity could not be updated." = "Activity could not be saved."
) {
  if (error instanceof AppError) return appErrorResponse(error);



  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2025")
  ) {
    return appErrorResponse(new AppError(evidenceErrors.theLinkedActivityRelationshipIsNoLongerAvailable));
  }

  console.error(logMessage, error);
  return appErrorResponse(new AppError(fallbackMessage === "Activity could not be updated." ? evidenceErrors.activityReplaceFailed : evidenceErrors.activityCreateFailed, error));
}
