import { NextResponse } from "next/server";
import { csvExportResponseHeaders } from "@/lib/csv-export-contract";
import { prisma } from "@/lib/prisma";
import {
  CsvExportError,
  createCsvExport,
  parseCsvExportKind
} from "@/lib/csv-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const kind = parseCsvExportKind((await params).kind);
    const result = await createCsvExport(kind, new Date(), prisma);
    return new Response(result.body, {
      status: 200,
      headers: csvExportResponseHeaders(result)
    });
  } catch (error) {
    if (error instanceof CsvExportError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("CSV export failed.", error);
    return NextResponse.json(
      {
        error: "CSV export could not be created.",
        code: "INTERNAL_ERROR"
      },
      { status: 500 }
    );
  }
}
