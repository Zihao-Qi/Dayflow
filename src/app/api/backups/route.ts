import { NextRequest } from "next/server";
import {
  createManagedBackup,
  getManagedBackupIndex
} from "@/lib/backup-management";
import {
  assertLocalBackupRead,
  assertLocalBackupMutation,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalBackupRead(request);
    return jsonNoStore(getManagedBackupIndex());
  } catch (error) {
    return backupErrorResponse(error, "Backup list");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    if (Object.keys(body).length > 0) {
      return jsonNoStore(
        {
          error: "Backup creation does not accept a destination path.",
          code: "VALIDATION_ERROR"
        },
        { status: 400 }
      );
    }
    return jsonNoStore(
      { backup: createManagedBackup() },
      { status: 201 }
    );
  } catch (error) {
    return backupErrorResponse(error, "Backup creation");
  }
}
