/** Catalog property order is wire order: message becomes error; status is omitted. */
export type ErrorSpec = {
  readonly status: number;
  readonly message: string;
  readonly code?: string;
  readonly field?: string;
  /** Historical Project completion response extension. */
  readonly requiresConfirmation?: true;
};

export class AppError extends Error {
  constructor(readonly spec: ErrorSpec, cause?: unknown) {
    super(spec.message, cause === undefined ? undefined : { cause });
    this.name = "AppError";
  }

  get status() { return this.spec.status; }
  get code() { return this.spec.code; }
  get field() { return this.spec.field; }
}

/** Callers retain their own dynamic validation messages and field policy. */
export function validation(message: string, field?: string, code = "VALIDATION_ERROR") {
  return new AppError({ status: 400, message, code, ...(field === undefined ? {} : { field }) });
}
