import { backupErrors } from "@/lib/backup-errors";
import {
  assertLocalBackupMutation,
  assertLocalBackupRead,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";
import {
  createManagedBackup,
  getManagedBackupIndex
} from "@/lib/backup-management";
import { appErrorResponse } from "@/lib/http-errors";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest } from "next/server";

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
      return appErrorResponse(new AppError(backupErrors.backupCreationDoesNotAcceptADestinationPath), true);
    }
    return jsonNoStore(
      { backup: createManagedBackup() },
      { status: 201 }
    );
  } catch (error) {
    return backupErrorResponse(error, "Backup creation");
  }
}
