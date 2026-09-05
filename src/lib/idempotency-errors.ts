import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the idempotency boundary. Property order is wire order. */
export const idempotencyErrors = {
  xDayflowMutationIdMustContain1To128Characters: {
    status: 400,
    message: "X-Dayflow-Mutation-Id must contain 1 to 128 characters.",
    code: "INVALID_MUTATION_ID"
  },
  thisMutationIdentifierWasAlreadyUsedForADifferentRequest: {
    status: 409,
    message: "This mutation identifier was already used for a different request.",
    code: "MUTATION_ID_CONFLICT"
  },
  theSavedMutationReceiptCouldNotBeRead: {
    status: 500,
    message: "The saved mutation receipt could not be read.",
    code: "INVALID_MUTATION_RECEIPT"
  }
} as const satisfies Record<string, ErrorSpec>;
