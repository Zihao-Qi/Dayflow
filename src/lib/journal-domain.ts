import {
  requireObject,
  parseEnum,
  parseRecordId,
  parseBoundedString,
  parseNullableLocalDate
} from "@/shared/kernel/parsing";
import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

export const JOURNAL_PAGE_DEFAULT_LIMIT = 50;
export const JOURNAL_PAGE_MAX_LIMIT = 100;
export const NOTE_CONTENT_MAX_LENGTH = 20_000;
export const NOTE_TAG_MAX_COUNT = 20;
export const NOTE_TAG_MAX_LENGTH = 50;
export const JOURNAL_SEARCH_MAX_LENGTH = 200;
export const MATERIAL_TITLE_MAX_LENGTH = 200;
export const MATERIAL_URL_MAX_LENGTH = 2_048;
export const MATERIAL_NOTES_MAX_LENGTH = 5_000;

export const materialTypes = [
  "website",
  "article",
  "youtube",
  "pdf",
  "reference"
] as const;

export type MaterialType = (typeof materialTypes)[number];
export type JournalCursorKind = "note" | "material";
export type JournalErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "INVALID_CURSOR"
  | "INVALID_MUTATION_ID"
  | "RELATIONSHIP_NOT_FOUND"
  | "ATTRIBUTION_CONFLICT";

export class JournalRequestError extends Error {
  constructor(
    public readonly code: JournalErrorCode,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "JournalRequestError";
  }
}

export type NoteCreateInput = {
  content: string;
  tags: string[];
  date: Date;
  taskId: string | null;
  projectId: string | null;
};

export type MaterialCreateInput = {
  title: string;
  url: string;
  type: MaterialType;
  notes: string;
  taskId: string | null;
  noteId: string | null;
  projectId: string | null;
};

export type JournalCursor = {
  createdAt: Date;
  id: string;
};

export function parseNoteCreateInput(
  value: unknown,
  now = new Date()
): NoteCreateInput {
  const body = parseBodyObject(value);
  const content = parseRequiredString(
    body.content,
    "content",
    "Write something before saving this note.",
    "Note content",
    NOTE_CONTENT_MAX_LENGTH
  );
  const date = parseJournalDate(body.date, now, "Note date is invalid.");

  return {
    content,
    tags: normalizeNoteTags(body.tags),
    date,
    taskId: parseOptionalRelationshipId(body.taskId, "taskId", "Task"),
    projectId: parseOptionalRelationshipId(body.projectId, "projectId", "Project")
  };
}

export function parseMaterialCreateInput(value: unknown): MaterialCreateInput {
  const body = parseBodyObject(value);
  const url = parseMaterialUrl(body.url);
  const type = parseMaterialType(body.type, url);
  const suppliedTitle = parseOptionalString(
    body.title,
    "title",
    "Material title",
    MATERIAL_TITLE_MAX_LENGTH
  );

  return {
    title: suppliedTitle || inferMaterialTitle(type),
    url,
    type,
    notes: parseOptionalString(
      body.notes,
      "notes",
      "Material notes",
      MATERIAL_NOTES_MAX_LENGTH
    ),
    taskId: parseOptionalRelationshipId(body.taskId, "taskId", "Task"),
    noteId: parseOptionalRelationshipId(body.noteId, "noteId", "Note"),
    projectId: parseOptionalRelationshipId(body.projectId, "projectId", "Project")
  };
}

export function parseJournalPage(
  searchParams: URLSearchParams,
  kind: JournalCursorKind,
  queryScope = ""
) {
  const limitValues = searchParams.getAll("limit");
  if (limitValues.length > 1) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Provide only one page limit."
    );
  }

  const rawLimit = limitValues[0];
  let limit = JOURNAL_PAGE_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      throw new JournalRequestError(
        "VALIDATION_ERROR",
        "Page limit must be a positive whole number."
      );
    }
    limit = Math.min(Number(rawLimit), JOURNAL_PAGE_MAX_LIMIT);
  }

  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    throw new JournalRequestError(
      "INVALID_CURSOR",
      "Provide only one pagination cursor."
    );
  }

  return {
    limit,
    cursor:
      cursorValues.length === 1
        ? decodeJournalCursor(cursorValues[0], kind, queryScope)
        : null
  };
}

export function encodeJournalCursor(
  kind: JournalCursorKind,
  value: { createdAt: Date; id: string },
  queryScope = ""
) {
  return Buffer.from(
    JSON.stringify(
      queryScope
        ? {
            version: 2,
            kind,
            scope: queryScope,
            createdAt: value.createdAt.toISOString(),
            id: value.id
          }
        : {
            version: 1,
            kind,
            createdAt: value.createdAt.toISOString(),
            id: value.id
          }
    ),
    "utf8"
  ).toString("base64url");
}

export function decodeJournalCursor(
  value: string,
  expectedKind: JournalCursorKind,
  expectedScope = ""
): JournalCursor {
  try {
    if (
      value.length > 1_024 ||
      !value.length ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new Error("Invalid encoding");
    }

    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const cursor = JSON.parse(decoded) as Record<string, unknown>;
    const createdAtText =
      typeof cursor.createdAt === "string" ? cursor.createdAt : "";
    const createdAt = new Date(createdAtText);
    const id = typeof cursor.id === "string" ? cursor.id : "";

    const scopeMatches =
      (cursor.version === 1 && expectedScope === "") ||
      (cursor.version === 2 &&
        expectedScope !== "" &&
        cursor.scope === expectedScope);

    if (
      !scopeMatches ||
      cursor.kind !== expectedKind ||
      !id ||
      id.length > 191 ||
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== createdAtText
    ) {
      throw new Error("Invalid payload");
    }

    return { createdAt, id };
  } catch {
    throw new JournalRequestError(
      "INVALID_CURSOR",
      "The pagination cursor is invalid."
    );
  }
}

export function parseStoredTags(value: string) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function parseBodyObject(value: unknown): Record<string, unknown> {
  return requireObject(
    value,
    "body",
    "The request body must be a JSON object.",
    validationError
  );
}

function parseRequiredString(
  value: unknown,
  field: string,
  emptyMessage: string,
  label: string,
  maxLength: number
) {
  return parseBoundedString(value, field, emptyMessage, validationError, {
    maximumLength: maxLength,
    lengthMessage: `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`,
    emptyMessage,
    trim: true
  });
}

function parseOptionalString(
  value: unknown,
  field: string,
  label: string,
  maxLength: number
) {
  if (value === undefined || value === null) return "";
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength: maxLength,
    lengthMessage: `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`,
    trim: true
  });
}

function parseOptionalRelationshipId(value: unknown, field: string, label: string) {
  return parseRecordId(value, field, `${label} identifier is invalid.`, validationError, {
    maximumLength: 191,
    rejectControlCharacters: false,
    nullValues: [undefined, null, ""],
    typeMessage: `${label} identifier must be text.`
  });
}

function parseJournalDate(value: unknown, now: Date, errorMessage: string) {
  return parseNullableLocalDate(value, "date", errorMessage, validationError, {
    nullValues: [undefined, null, ""],
    trim: false,
    parseDate: parseLocalDate
  }) ?? startOfLocalDay(now);
}

export function normalizeNoteTags(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Note tags must be an array of text values."
    );
  }
  if (value.length > NOTE_TAG_MAX_COUNT) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `A note can have at most ${NOTE_TAG_MAX_COUNT} tags.`
    );
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of value) {
    if (typeof rawTag !== "string") {
      throw new JournalRequestError(
        "VALIDATION_ERROR",
        "Note tags must contain only text values."
      );
    }
    const tag = rawTag
      .normalize("NFKC")
      .trim()
      .replace(/^#+/, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    if (!tag) continue;
    if (
      tag.length > NOTE_TAG_MAX_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(tag)
    ) {
      throw new JournalRequestError(
        "VALIDATION_ERROR",
        `Each note tag must be ${NOTE_TAG_MAX_LENGTH} characters or fewer.`
      );
    }
    if (!seen.has(tag)) {
      tags.push(tag);
      seen.add(tag);
    }
  }
  return tags;
}

function parseMaterialUrl(value: unknown) {
  const url = parseRequiredString(
    value,
    "url",
    "Add a URL before saving this reference.",
    "Material URL",
    MATERIAL_URL_MAX_LENGTH
  );

  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname
    ) {
      throw new Error("Unsupported URL");
    }
  } catch {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Material URL must be a valid http or https URL."
    );
  }
  return url;
}

function parseMaterialType(
  value: unknown,
  url: string
): MaterialType {
  if (value === undefined || value === null || value === "") {
    return inferMaterialType(url);
  }
  return parseEnum(
    value, materialTypes, "type",
    `Material type must be one of: ${materialTypes.join(", ")}.`, validationError,
    {
      normalize: (text) => text.trim().toLowerCase(),
      typeMessage: "Material type is invalid."
    }
  );
}

export function inferMaterialType(url: string): MaterialType {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "youtu.be" ||
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com")
  ) {
    return "youtube";
  }
  if (parsed.pathname.toLowerCase().endsWith(".pdf")) return "pdf";
  return "website";
}

export function inferMaterialTitle(type: MaterialType) {
  return type === "youtube" ? "YouTube material" : "Saved material";
}

function validationError(message: string) {
  return new JournalRequestError("VALIDATION_ERROR", message);
}
