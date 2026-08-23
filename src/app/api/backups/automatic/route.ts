import { NextRequest } from "next/server";
import {
  getAutomaticBackupState,
  setAutomaticBackupPolicy
} from "@/lib/backup-management";
import {
  assertLocalBackupMutation,
  assertLocalBackupRead,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";
import { AutomaticBackupPolicyError } from "@/lib/backup-schedule";

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
    if (error instanceof AutomaticBackupPolicyError) {
      return jsonNoStore(
        {
          error: error.message,
          code: "VALIDATION_ERROR",
          field: error.field
        },
        { status: 400 }
      );
    }
    return backupErrorResponse(error, "Automatic backup settings");
  }
}
