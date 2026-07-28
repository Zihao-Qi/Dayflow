import { closeSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { resolveManagedBackupDownload } from "@/lib/backup-management";
import {
  assertLocalBackupRead,
  backupErrorResponse
} from "@/lib/backup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertLocalBackupRead(request);
    const { id } = await context.params;
    const backup = resolveManagedBackupDownload(id);
    let nodeStream: ReturnType<typeof createReadStream>;
    try {
      nodeStream = createReadStream(backup.path, {
        fd: backup.fileDescriptor,
        autoClose: true
      });
    } catch (error) {
      closeSync(backup.fileDescriptor);
      throw error;
    }
    const stream = Readable.toWeb(nodeStream);
    return new Response(stream as ReadableStream, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${backup.fileName}"`,
        "Content-Length": String(backup.sizeBytes),
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return backupErrorResponse(error, "Backup download");
  }
}
