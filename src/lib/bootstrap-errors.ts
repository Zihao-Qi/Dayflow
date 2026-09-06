import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the bootstrap boundary. The serializer emits exactly the declared properties. */
export const bootstrapErrors = {
  migrationRequired: {
    status: 503,
    code: "DATABASE_MIGRATION_REQUIRED",
    message: "Dayflow's local database needs an update. Stop Dayflow, run `npm run db:migrate`, then start Dayflow again."
  },
  openFailed: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Dayflow could not open its local data. Try again."
  }
} as const satisfies Record<string, ErrorSpec>;
