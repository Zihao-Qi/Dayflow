/** Boundary-neutral parsing. Callers own messages, error types and policy. */
export type ErrorFactory<Field extends string = string> = (
  message: string,
  field: Field
) => Error;

export type JsonObject = Record<string, unknown>;

export function requireObject<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>
): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw error(message, field);
  }
  return value as JsonObject;
}

export function has(object: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function parseEnum<const Values extends readonly string[], Field extends string>(
  value: unknown,
  values: Values,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: { normalize?: (value: string) => string; typeMessage?: string } = {}
): Values[number] {
  if (typeof value !== "string") {
    throw error(options.typeMessage ?? message, field);
  }
  const normalized = options.normalize ? options.normalize(value) : value;
  if (!values.includes(normalized)) throw error(message, field);
  return normalized as Values[number];
}

export function parseBoundedInteger<Field extends string>(
  value: unknown,
  field: Field,
  minimum: number,
  maximum: number,
  message: string,
  error: ErrorFactory<Field>
) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw error(message, field);
  }
  return value;
}

export function parseBoundedString<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: {
    maximumLength: number;
    lengthMessage: string;
    emptyMessage?: string;
    trim: boolean;
  }
) {
  if (typeof value !== "string") throw error(message, field);
  const text = options.trim ? value.trim() : value;
  if (!text && options.emptyMessage !== undefined) {
    throw error(options.emptyMessage, field);
  }
  if (text.length > options.maximumLength) {
    throw error(options.lengthMessage, field);
  }
  return text;
}

type EmptyValue = null | undefined | "";

type RecordIdOptions = {
  maximumLength: number;
  rejectControlCharacters: boolean;
  typeMessage?: string;
  nullValues?: readonly EmptyValue[];
  blankAsNull?: boolean;
};

export function parseRecordId<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: RecordIdOptions & { nullValues?: never; blankAsNull?: false }
): string;
export function parseRecordId<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: RecordIdOptions
): string | null;
export function parseRecordId<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: RecordIdOptions
) {
  // Check raw sentinels before trimming: "" and whitespace can mean different things.
  if (options.nullValues?.some((empty) => value === empty)) return null;
  if (typeof value !== "string") {
    throw error(options.typeMessage ?? message, field);
  }
  const id = value.trim();
  if (!id && options.blankAsNull) return null;
  if (
    !id ||
    id.length > options.maximumLength ||
    (options.rejectControlCharacters && /[\u0000-\u001f\u007f]/.test(id))
  ) {
    throw error(message, field);
  }
  return id;
}

export function parseNullableLocalDate<Field extends string>(
  value: unknown,
  field: Field,
  message: string,
  error: ErrorFactory<Field>,
  options: {
    nullValues: readonly EmptyValue[];
    trim: boolean;
    // The caller supplies its calendar parser; the kernel has no legacy imports.
    parseDate: (value: string) => Date | null;
    dateOnly?: boolean;
  }
) {
  if (options.nullValues.some((empty) => value === empty)) return null;
  if (typeof value !== "string") throw error(message, field);
  const text = options.trim ? value.trim() : value;
  if (options.dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw error(message, field);
  }
  const date = options.parseDate(text);
  if (!date) throw error(message, field);
  return date;
}

export async function readJsonBody<Field extends string>(
  request: { json(): Promise<unknown> },
  field: Field,
  message: string,
  error: ErrorFactory<Field>
): Promise<unknown> {
  // Shape validation belongs outside this catch so it retains its own error code.
  try {
    return await request.json();
  } catch {
    throw error(message, field);
  }
}
