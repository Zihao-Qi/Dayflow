import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  encodeJournalCursor, journalLiteralLikePattern, parseJournalPage, parseSearchText, parseTagFilter,
  type JournalCursor, type JournalCursorKind, type JournalHistoryPage
} from "../domain/journal";

export type JournalHistoryCriteria = {
  text: string;
  tag: string | null;
  scope: string;
  limit: number;
  cursor: JournalCursor | null;
};

/** The hash is a server concern; normalization and cursor validation are pure domain rules. */
export function parseJournalHistoryCriteria(searchParams: URLSearchParams, kind: JournalCursorKind): JournalHistoryCriteria {
  const text = parseSearchText(searchParams);
  const tag = parseTagFilter(searchParams, kind);
  const scope = text || tag
    ? createHash("sha256").update(JSON.stringify({ version: 1, kind, text, tag })).digest("base64url")
    : "";
  return { text, tag, scope, ...parseJournalPage(searchParams, kind, scope) };
}

/**
 * Caller supplies one read transaction so the page and total share its snapshot.
 * SQL identifiers/fragments below are closed constants. Every request value is a
 * bound parameter, including the escaped LIKE pattern and cursor boundary.
 */
export async function readCollectionHistory<Stored extends { createdAt: Date; id: string }>(
  tx: Prisma.TransactionClient,
  kind: JournalCursorKind,
  criteria: JournalHistoryCriteria
): Promise<JournalHistoryPage<Stored>> {
  const table = kind === "note" ? '"Note"' : '"Material"';
  const filters: string[] = [];
  const values: unknown[] = [];
  if (criteria.text) {
    const pattern = journalLiteralLikePattern(criteria.text);
    if (kind === "note") {
      filters.push(`${table}."content" COLLATE NOCASE LIKE ? ESCAPE '!'`);
      values.push(pattern);
    } else {
      filters.push(`(${table}."title" COLLATE NOCASE LIKE ? ESCAPE '!'
        OR ${table}."url" COLLATE NOCASE LIKE ? ESCAPE '!'
        OR ${table}."notes" COLLATE NOCASE LIKE ? ESCAPE '!')`);
      values.push(pattern, pattern, pattern);
    }
  }
  if (kind === "note" && criteria.tag) {
    filters.push(`EXISTS (
      SELECT 1 FROM json_each(
        CASE WHEN json_valid("Note"."tags") THEN
          CASE WHEN json_type("Note"."tags") = 'array' THEN "Note"."tags" ELSE '[]' END
        ELSE '[]' END
      ) AS "NoteTag" WHERE "NoteTag"."value" = ?
    )`);
    values.push(criteria.tag);
  }
  const pageClauses = [...filters];
  const pageValues = [...values];
  if (criteria.cursor) {
    pageClauses.push(`(${table}."createdAt" < ? OR (${table}."createdAt" = ? AND ${table}."id" < ?))`);
    pageValues.push(criteria.cursor.createdAt, criteria.cursor.createdAt, criteria.cursor.id);
  }
  const where = (clauses: string[]) => clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const records = await tx.$queryRawUnsafe<Stored[]>(
    `SELECT ${table}.* FROM ${table} ${where(pageClauses)}
     ORDER BY ${table}."createdAt" DESC, ${table}."id" DESC LIMIT ?`,
    ...pageValues, criteria.limit + 1
  );
  const countRows = await tx.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS "count" FROM ${table} ${where(filters)}`, ...values
  );
  const items = records.slice(0, criteria.limit);
  const last = records.length > criteria.limit ? items.at(-1) : null;
  return {
    items,
    nextCursor: last ? encodeJournalCursor(kind, last, criteria.scope) : null,
    totalCount: Number(countRows[0]?.count ?? 0)
  };
}
