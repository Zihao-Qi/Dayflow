import { NextRequest } from "next/server";
import {
  cancelManagedRestore,
  getManagedBackupIndex,
  stageManagedRestore
} from "@/lib/backup-management";
import {
  assertLocalBackupMutation,
  backupErrorResponse,
  jsonNoStore,
  readBackupJsonObject
} from "@/lib/backup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
      return jsonNoStore(
        {
          error: `Unexpected restore field: ${unexpected}.`,
          code: "VALIDATION_ERROR",
          field: unexpected
        },
        { status: 400 }
      );
    }
    if (typeof body.backupId !== "string") {
      return validationResponse("Choose a managed backup.", "backupId");
    }
    if (typeof body.expectedPayloadSha256 !== "string") {
      return validationResponse(
        "The selected backup checksum is required.",
        "expectedPayloadSha256"
      );
    }
    if (typeof body.confirmation !== "string") {
      return validationResponse(
        "Type RESTORE exactly to schedule replacement.",
        "confirmation"
      );
    }

    const pendingRestore = stageManagedRestore({
      backupId: body.backupId,
      expectedPayloadSha256: body.expectedPayloadSha256,
      confirmation: body.confirmation
    });
    return jsonNoStore(
      { ...getManagedBackupIndex(), pendingRestore },
      { status: 202 }
    );
  } catch (error) {
    return backupErrorResponse(error, "Restore scheduling");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertLocalBackupMutation(request);
    const body = await readBackupJsonObject(request);
    if (Object.keys(body).length > 0) {
      return jsonNoStore(
        {
          error: "Canceling a restore does not accept any fields.",
          code: "VALIDATION_ERROR"
        },
        { status: 400 }
      );
    }
    cancelManagedRestore();
    return jsonNoStore(getManagedBackupIndex());
  } catch (error) {
    return backupErrorResponse(error, "Restore cancellation");
  }
}

function validationResponse(error: string, field: string) {
  return jsonNoStore(
    { error, code: "VALIDATION_ERROR", field },
    { status: 400 }
  );
}
