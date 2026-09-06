import { requestErrors } from "@/lib/request-errors";
import { AppError, validation } from "@/shared/kernel/errors";
import { requireObject as kernelRequireObject, parseRecordId, readJsonBody } from "@/shared/kernel/parsing";

export const WORKFLOW_ID_MAX_LENGTH = 191;
export const WORKFLOW_ID_ARRAY_MAX_ITEMS = 1_000;
type JsonObject = Record<string, unknown>;
export type WorkflowMutationErrorCode = "INVALID_JSON" | "VALIDATION_ERROR";
export { AppError as WorkflowMutationRequestError };
export { FOCUS_LABEL_MAX_LENGTH, FOCUS_COMPLETION_NOTE_MAX_LENGTH, FOCUS_CATEGORY_MAX_LENGTH,
  parseFocusSessionStartMutation, parseFocusSessionTransitionMutation, type FocusAction } from "@/modules/focus/domain/session";
export { parseFocusQueueAddMutation, parseFocusQueueReorderMutation, parseFocusQueueRemoveMutation,
  type QueuePlacementMutation } from "@/modules/planning/domain/focus-queue";
export { parseTaskReorderMutation } from "@/modules/planning/domain/task";

export async function readWorkflowMutationBody(request: { json(): Promise<unknown> }): Promise<JsonObject> {
  const body = await readJsonBody(request, "body", requestErrors.invalidJson.message, () => new AppError(requestErrors.invalidJson));
  return kernelRequireObject(body, "body", requestErrors.objectRequired.message, validation);
}

export function parseWorkflowId(value: unknown, field: string, message = "Identifier is invalid.") {
  return parseRecordId(value, field, message, validation, { maximumLength: WORKFLOW_ID_MAX_LENGTH, rejectControlCharacters: true });
}
