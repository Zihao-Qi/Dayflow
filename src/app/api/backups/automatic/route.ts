import {
  assertLocalBackupMutation,
  assertLocalBackupRead,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";
import {
  getAutomaticBackupState,
  setAutomaticBackupPolicy
} from "@/lib/backup-management";
import { appErrorResponse } from "@/lib/http-errors";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalBackupRead(request);
    return jsonNoStore(getAutomaticBackupState());
  } catch (error) {
    return backupErrorResponse(error, "Automatic backup settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    return jsonNoStore(setAutomaticBackupPolicy(body));
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error, true);
    return backupErrorResponse(error, "Automatic backup settings");
  }
}
