import { clock } from "@/lib/time";
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
  const now = clock.now();
  try {
    assertLocalBackupRead(request);
    return jsonNoStore(getAutomaticBackupState({ now }));
  } catch (error) {
    return backupErrorResponse(error, "Automatic backup settings");
  }
}

export async function PUT(request: NextRequest) {
  const now = clock.now();
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    return jsonNoStore(setAutomaticBackupPolicy(body, { now }));
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error, true);
    return backupErrorResponse(error, "Automatic backup settings");
  }
}
