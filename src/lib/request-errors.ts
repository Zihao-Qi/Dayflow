import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the request boundary. Property order is wire order. */
export const requestErrors = {
  invalidJson: {
    status: 400,
    message: "Request body must be valid JSON.",
    code: "INVALID_JSON",
    field: "body"
  },
  objectRequired: {
    status: 400,
    message: "Request body must be a JSON object.",
    code: "VALIDATION_ERROR",
    field: "body"
  }
} as const satisfies Record<string, ErrorSpec>;
