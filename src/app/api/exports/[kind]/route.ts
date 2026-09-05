import { clock } from "@/lib/time";
import {
  createCsvExport,
  parseCsvExportKind,
  readCsvExport
} from "@/server/read-models/csv-export";
import { csvExportResponseHeaders } from "@/lib/csv-export-contract";
import { csvExportErrors } from "@/lib/csv-export-errors";
import { appErrorResponse } from "@/lib/http-errors";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string }> };

export async function GET(_request: Request, { params }: Params) {
  const now = clock.now();
  try {
    const kind = parseCsvExportKind((await params).kind);
    const rows = await prisma.$transaction(tx => readCsvExport(kind, tx));
    const result = createCsvExport(rows, now);
    return new Response(result.body, {
      status: 200,
      headers: csvExportResponseHeaders(result)
    });
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);

    console.error("CSV export failed.", error);
    return appErrorResponse(new AppError(csvExportErrors.exportFailed));
  }
}
