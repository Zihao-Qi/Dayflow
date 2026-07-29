import { parseLocalDate } from "@/lib/dates";

export const CSV_EXPORT_FORMAT = "dayflow-csv";
export const CSV_EXPORT_VERSION = 1;
export const CSV_EXPORT_KINDS = ["tasks", "activities"] as const;
export const CSV_EXPORT_CONTENT_TYPE = "text/csv; charset=utf-8";

export const CSV_EXPORT_HEADERS = {
  cacheControl: "Cache-Control",
  contentDisposition: "Content-Disposition",
  contentType: "Content-Type",
  contentTypeOptions: "X-Content-Type-Options",
  format: "X-Dayflow-Export-Format",
  kind: "X-Dayflow-Export-Kind",
  version: "X-Dayflow-Export-Version",
  fileName: "X-Dayflow-File-Name",
  recordCount: "X-Dayflow-Record-Count"
} as const;

export type CsvExportKind = (typeof CSV_EXPORT_KINDS)[number];

export type CsvExportResponseMetadata = {
  fileName: string;
  recordCount: number;
};

export function isCsvExportKind(value: unknown): value is CsvExportKind {
  return (
    typeof value === "string" &&
    CSV_EXPORT_KINDS.includes(value as CsvExportKind)
  );
}

export function csvExportFileName(kind: CsvExportKind, date: string) {
  return `dayflow-${kind}-${date}.csv`;
}

export function isCsvExportFileName(
  kind: CsvExportKind,
  value: unknown
): value is string {
  if (typeof value !== "string") return false;
  const match = new RegExp(
    `^dayflow-${kind}-(\\d{4}-\\d{2}-\\d{2})\\.csv$`
  ).exec(value);
  return Boolean(match && parseLocalDate(match[1]));
}

export function csvExportResponseHeaders({
  kind,
  fileName,
  recordCount
}: CsvExportResponseMetadata & { kind: CsvExportKind }) {
  return {
    [CSV_EXPORT_HEADERS.cacheControl]: "no-store",
    [CSV_EXPORT_HEADERS.contentDisposition]:
      `attachment; filename="${fileName}"`,
    [CSV_EXPORT_HEADERS.contentType]: CSV_EXPORT_CONTENT_TYPE,
    [CSV_EXPORT_HEADERS.contentTypeOptions]: "nosniff",
    [CSV_EXPORT_HEADERS.format]: CSV_EXPORT_FORMAT,
    [CSV_EXPORT_HEADERS.kind]: kind,
    [CSV_EXPORT_HEADERS.version]: String(CSV_EXPORT_VERSION),
    [CSV_EXPORT_HEADERS.fileName]: fileName,
    [CSV_EXPORT_HEADERS.recordCount]: String(recordCount)
  };
}

export function parseCsvExportResponseMetadata(
  kind: CsvExportKind,
  headers: Pick<Headers, "get">
): CsvExportResponseMetadata | null {
  const fileName = headers.get(CSV_EXPORT_HEADERS.fileName);
  const recordCountText = headers.get(CSV_EXPORT_HEADERS.recordCount);
  const recordCount = Number(recordCountText);
  if (
    headers.get(CSV_EXPORT_HEADERS.contentType) !==
      CSV_EXPORT_CONTENT_TYPE ||
    headers.get(CSV_EXPORT_HEADERS.format) !== CSV_EXPORT_FORMAT ||
    headers.get(CSV_EXPORT_HEADERS.version) !==
      String(CSV_EXPORT_VERSION) ||
    headers.get(CSV_EXPORT_HEADERS.kind) !== kind ||
    !recordCountText ||
    !/^(0|[1-9]\d*)$/.test(recordCountText) ||
    !Number.isSafeInteger(recordCount) ||
    !isCsvExportFileName(kind, fileName) ||
    headers.get(CSV_EXPORT_HEADERS.contentDisposition) !==
      `attachment; filename="${fileName}"`
  ) {
    return null;
  }
  return { fileName, recordCount };
}
