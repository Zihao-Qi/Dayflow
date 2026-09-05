import { AppError } from "@/shared/kernel/errors";

/**
 * Constructor-shaped compatibility for frozen characterization callers.
 * There is no legacy error instance or subclass; production throws AppError.
 */
export function appErrorConstructor<Args extends unknown[]>(
  create: (...args: Args) => AppError,
  matches: (error: AppError) => boolean = () => true
): new (...args: Args) => AppError {
  function construct(...args: Args) { return create(...args); }
  Object.defineProperty(construct, Symbol.hasInstance, {
    value: (error: unknown) => error instanceof AppError && matches(error)
  });
  return construct as unknown as new (...args: Args) => AppError;
}
