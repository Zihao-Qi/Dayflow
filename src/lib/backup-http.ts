import { backupErrors } from "@/lib/backup-errors";
import { appErrorResponse } from "@/lib/http-errors";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export function assertLocalBackupMutation(request: NextRequest) {
  if (request.headers.get("x-dayflow-local-action") !== "1") {
    throw new AppError(backupErrors.thisLocalDataActionRequiresAnExplicitDayflowRequest);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError(backupErrors.useApplicationjsonForLocalDataActions);
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
    throw new AppError(backupErrors.crossoriginLocalDataActionsAreNotAllowed);
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
    throw new AppError(backupErrors.theRequestBodyMustBeValidJSON);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(backupErrors.theRequestBodyMustBeAJSONObject);
  }
  return value as Record<string, unknown>;
}

export function backupErrorResponse(error: unknown, operation: keyof typeof backupOperationErrors) {
  if (error instanceof AppError) return appErrorResponse(error, true);

  console.error(`${operation} failed.`, error);
  return appErrorResponse(new AppError(backupOperationErrors[operation], error), true);
}

export function jsonNoStore(
  body: unknown,
  init: { status?: number } = {}
) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function assertSafeFetchSite(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError(backupErrors.crosssiteLocalDataRequestsAreNotAllowed);
  }
}

const backupOperationErrors = {
  "Backup operation": backupErrors.operationFailed,
  "Backup list": backupErrors.backupListFailed,
  "Backup creation": backupErrors.backupCreationFailed,
  "Automatic backup settings": backupErrors.automaticBackupSettingsFailed,
  "Backup download": backupErrors.backupDownloadFailed,
  "Restore scheduling": backupErrors.restoreSchedulingFailed,
  "Restore cancellation": backupErrors.restoreCancellationFailed
};
