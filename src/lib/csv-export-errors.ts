import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the csv-export boundary. The serializer emits exactly the declared properties. */
export const csvExportErrors = {
  exportNotFound: {
    status: 404,
    message: "CSV export not found.",
    code: "EXPORT_NOT_FOUND"
  },
  exportFailed: {
    status: 500,
    message: "CSV export could not be created.",
    code: "INTERNAL_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
