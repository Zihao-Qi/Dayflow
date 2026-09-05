export type Decoder<T> = (value: unknown) => value is T;

type ErrorOptions = {
  fallback: string;
  invalidMessage?: string;
  fallbackCode?: string;
  invalidCode?: string;
  /** Some workflows deliberately show a fixed message for HTTP errors. */
  useEnvelopeMessage?: boolean;
};

type RequestOptions<T> = ErrorOptions & {
  method?: string;
  body?: unknown;
  mutationId?: string | null;
  localAction?: boolean;
  cache?: RequestCache;
  signal?: AbortSignal;
  decode: Decoder<T>;
  /** Only the two legacy Project detail reads propagate JSON syntax errors. */
  strictJson?: boolean;
};

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly field: string | undefined,
    readonly kind: "http" | "decode" = "http"
  ) {
    super(message);
  }
}

function failure(
  response: Response,
  value: unknown,
  options: ErrorOptions,
  invalid: boolean
) {
  const envelope = value && typeof value === "object"
    ? value as { code?: unknown; error?: unknown; field?: unknown }
    : null;
  const message = invalid && options.invalidMessage !== undefined
    ? options.invalidMessage
    : options.useEnvelopeMessage !== false && typeof envelope?.error === "string"
      ? envelope.error
      : options.fallback;
  const code = invalid && options.invalidCode !== undefined
    ? options.invalidCode
    : typeof envelope?.code === "string" ? envelope.code : options.fallbackCode;
  return new ApiError(
    response.status,
    code,
    message,
    typeof envelope?.field === "string" ? envelope.field : undefined,
    invalid ? "decode" : "http"
  );
}

type BlobRequestOptions<T> = Omit<RequestOptions<T>, "decode"> & {
  responseType: "blob";
  /** Validate export headers before consuming or downloading the successful body. */
  decode: (headers: Headers) => T | null;
};

type BlobResult<T> = { blob: Blob; metadata: T };

export function request<T>(path: string, options: RequestOptions<T>): Promise<T>;
export function request<T>(path: string, options: BlobRequestOptions<T>): Promise<BlobResult<T>>;
export async function request<T>(
  path: string,
  options: RequestOptions<T> | BlobRequestOptions<T>
): Promise<T | BlobResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.mutationId) headers["X-Dayflow-Mutation-Id"] = options.mutationId;
  if (options.localAction) headers["X-Dayflow-Local-Action"] = "1";
  const response = await fetch(path, {
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  if ("responseType" in options) {
    if (!response.ok) {
      throw failure(response, await response.json().catch(() => null), options, false);
    }
    const metadata = options.decode(response.headers);
    if (metadata === null) throw failure(response, null, options, true);
    return { blob: await response.blob(), metadata };
  }
  const value: unknown = await response.json().catch((error: unknown) => {
    if (response.ok && options.strictJson) throw error;
    return null;
  });
  if (!response.ok) throw failure(response, value, options, false);
  if (!options.decode(value)) throw failure(response, value, options, true);
  return value;
}
