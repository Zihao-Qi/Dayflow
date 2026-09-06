import { clock } from "@/lib/time";
import { backupErrors } from "@/lib/backup-errors";
import {
  assertLocalBackupMutation,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";
import {
  cancelManagedRestore,
  getManagedBackupIndex,
  stageManagedRestore
} from "@/lib/backup-management";
import { appErrorResponse } from "@/lib/http-errors";
import { AppError, validation } from "@/shared/kernel/errors";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    const allowedFields = new Set([
      "backupId",
      "expectedPayloadSha256",
      "confirmation"
    ]);
    const unexpected = Object.keys(body).find(
      (field) => !allowedFields.has(field)
    );
    if (unexpected) {
      return appErrorResponse(validation(`Unexpected restore field: ${unexpected}.`, unexpected), true);
    }
    if (typeof body.backupId !== "string") {
      return appErrorResponse(new AppError(backupErrors.chooseAManagedBackup), true);
    }
    if (typeof body.expectedPayloadSha256 !== "string") {
      return appErrorResponse(new AppError(backupErrors.theSelectedBackupChecksumIsRequired), true);
    }
    if (typeof body.confirmation !== "string") {
      return appErrorResponse(new AppError(backupErrors.typeRESTOREExactlyToScheduleReplacement), true);
    }

    const pendingRestore = stageManagedRestore({
      backupId: body.backupId,
      expectedPayloadSha256: body.expectedPayloadSha256,
      confirmation: body.confirmation
    }, { now });
    return jsonNoStore(
      { ...getManagedBackupIndex({ now }), pendingRestore },
      { status: 202 }
    );
  } catch (error) {
    return backupErrorResponse(error, "Restore scheduling");
  }
}

export async function DELETE(request: NextRequest) {
  const now = clock.now();
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    if (Object.keys(body).length > 0) {
      return appErrorResponse(new AppError(backupErrors.cancelingARestoreDoesNotAcceptAnyFields), true);
    }
    cancelManagedRestore();
    return jsonNoStore(getManagedBackupIndex({ now }));
  } catch (error) {
    return backupErrorResponse(error, "Restore cancellation");
  }
}
