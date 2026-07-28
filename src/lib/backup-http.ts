import { NextRequest, NextResponse } from "next/server";
import { BackupManagementError } from "@/lib/backup-management";

export function assertLocalBackupMutation(request: NextRequest) {
  if (request.headers.get("x-dayflow-local-action") !== "1") {
    throw new BackupHttpError(
      "This local data action requires an explicit Dayflow request.",
      "FORBIDDEN",
      403
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new BackupHttpError(
      "Use application/json for local data actions.",
      "UNSUPPORTED_MEDIA_TYPE",
      415
    );
  }
  const origin = request.headers.get("origin");
  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const requestProtocol =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.replace(":", "");
  const requestOrigin = requestHost
    ? `${requestProtocol}://${requestHost}`
    : request.nextUrl.origin;
  if (origin && origin !== requestOrigin) {
    throw new BackupHttpError(
      "Cross-origin local data actions are not allowed.",
      "FORBIDDEN",
      403
    );
  }
  assertSafeFetchSite(request);
}

export function assertLocalBackupRead(request: NextRequest) {
  assertSafeFetchSite(request);
}

export async function readBackupJsonObject(request: NextRequest) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new BackupHttpError(
      "The request body must be valid JSON.",
      "INVALID_JSON",
      400
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackupHttpError(
      "The request body must be a JSON object.",
      "VALIDATION_ERROR",
      400
    );
  }
  return value as Record<string, unknown>;
}

export function backupErrorResponse(error: unknown, operation: string) {
  if (error instanceof BackupManagementError) {
    return jsonNoStore(
      {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {})
      },
      { status: error.status }
    );
  }
  if (error instanceof BackupHttpError) {
    return jsonNoStore(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error(`${operation} failed.`, error);
  return jsonNoStore(
    {
      error: `${operation} could not be completed.`,
      code: "INTERNAL_ERROR"
    },
    { status: 500 }
  );
}

export function jsonNoStore(
  body: unknown,
  init: { status?: number } = {}
) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

class BackupHttpError extends Error {
  constructor(
    message: string,
    readonly code:
      | "FORBIDDEN"
      | "UNSUPPORTED_MEDIA_TYPE"
      | "INVALID_JSON"
      | "VALIDATION_ERROR",
    readonly status: 400 | 403 | 415
  ) {
    super(message);
    this.name = "BackupHttpError";
  }
}

function assertSafeFetchSite(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new BackupHttpError(
      "Cross-site local data requests are not allowed.",
      "FORBIDDEN",
      403
    );
  }
}
