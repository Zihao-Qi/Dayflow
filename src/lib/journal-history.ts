import { createHash } from "node:crypto";
import {
  Prisma,
  type Material as StoredMaterial,
  type Note as StoredNote,
  type PrismaClient
} from "@prisma/client";
import {
  encodeJournalCursor,
  JournalRequestError,
  JOURNAL_SEARCH_MAX_LENGTH,
  normalizeNoteTags,
  parseJournalPage,
  parseStoredTags,
  type JournalCursor,
  type JournalCursorKind
} from "@/lib/journal-domain";

type NoteHistoryRecord = Omit<StoredNote, "tags"> & { tags: string[] };
type JournalHistoryPage<T> = {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
};
type JournalHistoryCriteria = {
  text: string;
  tag: string | null;
  scope: string;
  limit: number;
  cursor: JournalCursor | null;
};

export function readJournalHistory(
  database: PrismaClient,
  kind: "note",
  searchParams: URLSearchParams
): Promise<JournalHistoryPage<NoteHistoryRecord>>;
export function readJournalHistory(
  database: PrismaClient,
  kind: "material",
  searchParams: URLSearchParams
): Promise<JournalHistoryPage<StoredMaterial>>;
export async function readJournalHistory(
  database: PrismaClient,
  kind: JournalCursorKind,
  searchParams: URLSearchParams
): Promise<JournalHistoryPage<NoteHistoryRecord | StoredMaterial>> {
  const criteria = parseJournalHistoryCriteria(searchParams, kind);
  return kind === "note"
    ? readNoteHistory(database, criteria)
    : readMaterialHistory(database, criteria);
}

async function readNoteHistory(
  database: PrismaClient,
  criteria: JournalHistoryCriteria
): Promise<JournalHistoryPage<NoteHistoryRecord>> {
  const filters: Prisma.Sql[] = [];
  if (criteria.text) {
    filters.push(
      Prisma.sql`"Note"."content" COLLATE NOCASE LIKE ${journalLiteralLikePattern(
        criteria.text
      )} ESCAPE '!'`
    );
  }
  if (criteria.tag) {
    filters.push(
      Prisma.sql`EXISTS (
        SELECT 1
        FROM json_each(
          CASE
            WHEN json_valid("Note"."tags") THEN
              CASE
                WHEN json_type("Note"."tags") = 'array' THEN "Note"."tags"
                ELSE '[]'
              END
            ELSE '[]'
          END
        ) AS "NoteTag"
        WHERE "NoteTag"."value" = ${criteria.tag}
      )`
    );
  }
  return readCollectionHistory<StoredNote, NoteHistoryRecord>(
    database,
    "Note",
    "note",
    criteria,
    filters,
    (records) =>
      records.map((note) => ({
        ...note,
        tags: parseStoredTags(note.tags)
      }))
  );
}

async function readMaterialHistory(
  database: PrismaClient,
  criteria: JournalHistoryCriteria
): Promise<JournalHistoryPage<StoredMaterial>> {
  const filters: Prisma.Sql[] = [];
  if (criteria.text) {
    const pattern = journalLiteralLikePattern(criteria.text);
    filters.push(
      Prisma.sql`(
        "Material"."title" COLLATE NOCASE LIKE ${pattern} ESCAPE '!'
        OR "Material"."url" COLLATE NOCASE LIKE ${pattern} ESCAPE '!'
        OR "Material"."notes" COLLATE NOCASE LIKE ${pattern} ESCAPE '!'
      )`
    );
  }
  return readCollectionHistory<StoredMaterial, StoredMaterial>(
    database,
    "Material",
    "material",
    criteria,
    filters,
    (records) => records
  );
}

async function readCollectionHistory<
  Stored extends { createdAt: Date; id: string },
  Item
>(
  database: PrismaClient,
  table: "Note" | "Material",
  kind: JournalCursorKind,
  criteria: JournalHistoryCriteria,
  filters: Prisma.Sql[],
  mapItems: (records: Stored[]) => Item[]
): Promise<JournalHistoryPage<Item>> {
  const pageClauses = [...filters];
  if (criteria.cursor) {
    pageClauses.push(cursorClause(table, criteria.cursor));
  }
  const tableIdentifier = Prisma.raw(`"${table}"`);
  const [records, countRows] = await database.$transaction([
    database.$queryRaw<Stored[]>(Prisma.sql`
      SELECT ${tableIdentifier}.*
      FROM ${tableIdentifier}
      ${sqlWhere(pageClauses)}
      ORDER BY ${tableIdentifier}."createdAt" DESC, ${tableIdentifier}."id" DESC
      LIMIT ${criteria.limit + 1}
    `),
    database.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS "count"
      FROM ${tableIdentifier}
      ${sqlWhere(filters)}
    `)
  ]);

  const hasMore = records.length > criteria.limit;
  const pageRecords = records.slice(0, criteria.limit);
  const last = hasMore ? pageRecords.at(-1) ?? null : null;

  return {
    items: mapItems(pageRecords),
    nextCursor: last
      ? encodeJournalCursor(kind, last, criteria.scope)
      : null,
    totalCount: Number(countRows[0]?.count ?? 0)
  };
}

export function parseJournalHistoryCriteria(
  searchParams: URLSearchParams,
  kind: JournalCursorKind
): JournalHistoryCriteria {
  const text = parseSearchText(searchParams);
  const tag = parseTagFilter(searchParams, kind);
  const scope =
    text || tag
      ? createHash("sha256")
          .update(JSON.stringify({ version: 1, kind, text, tag }))
          .digest("base64url")
      : "";
  const page = parseJournalPage(searchParams, kind, scope);
  return { text, tag, scope, ...page };
}

function parseSearchText(searchParams: URLSearchParams) {
  const values = searchParams.getAll("q");
  if (values.length > 1) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Provide only one Journal search query."
    );
  }
  const text = (values[0] ?? "").normalize("NFKC").trim();
  if (text.length > JOURNAL_SEARCH_MAX_LENGTH) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `Journal search must be ${JOURNAL_SEARCH_MAX_LENGTH} characters or fewer.`
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Journal search cannot contain control characters."
    );
  }
  return text;
}

function parseTagFilter(
  searchParams: URLSearchParams,
  kind: JournalCursorKind
) {
  const values = searchParams.getAll("tag");
  if (values.length > 1) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Provide only one Note tag filter."
    );
  }
  if (kind === "material" && values.length > 0) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Tag filtering is available only for Notes."
    );
  }
  if (values.length === 0) return null;
  return normalizeNoteTags([values[0]])[0] ?? null;
}

export function journalLiteralLikePattern(text: string) {
  return `%${text.replace(/[!%_]/g, "!$&")}%`;
}

function cursorClause(table: "Note" | "Material", cursor: JournalCursor) {
  return table === "Note"
    ? Prisma.sql`(
        "Note"."createdAt" < ${cursor.createdAt}
        OR (
          "Note"."createdAt" = ${cursor.createdAt}
          AND "Note"."id" < ${cursor.id}
        )
      )`
    : Prisma.sql`(
        "Material"."createdAt" < ${cursor.createdAt}
        OR (
          "Material"."createdAt" = ${cursor.createdAt}
          AND "Material"."id" < ${cursor.id}
        )
      )`;
}

function sqlWhere(clauses: Prisma.Sql[]) {
  return clauses.length
    ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`
    : Prisma.empty;
}
