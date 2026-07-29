import { parseLocalDate, startOfLocalDay } from "@/lib/dates";

export const JOURNAL_PAGE_DEFAULT_LIMIT = 50;
export const JOURNAL_PAGE_MAX_LIMIT = 100;
export const NOTE_CONTENT_MAX_LENGTH = 20_000;
export const NOTE_TAG_MAX_COUNT = 20;
export const NOTE_TAG_MAX_LENGTH = 50;
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
    "Write something before saving this note.",
    "Note content",
    NOTE_CONTENT_MAX_LENGTH
  );
  const date = parseJournalDate(body.date, now, "Note date is invalid.");

  return {
    content,
    tags: normalizeNoteTags(body.tags),
    date,
    taskId: parseOptionalRelationshipId(body.taskId, "Task"),
    projectId: parseOptionalRelationshipId(body.projectId, "Project")
  };
}

export function parseMaterialCreateInput(value: unknown): MaterialCreateInput {
  const body = parseBodyObject(value);
  const url = parseMaterialUrl(body.url);
  const type = parseMaterialType(body.type, url);
  const suppliedTitle = parseOptionalString(
    body.title,
    "Material title",
    MATERIAL_TITLE_MAX_LENGTH
  );

  return {
    title: suppliedTitle || inferMaterialTitle(type),
    url,
    type,
    notes: parseOptionalString(
      body.notes,
      "Material notes",
      MATERIAL_NOTES_MAX_LENGTH
    ),
    taskId: parseOptionalRelationshipId(body.taskId, "Task"),
    noteId: parseOptionalRelationshipId(body.noteId, "Note"),
    projectId: parseOptionalRelationshipId(body.projectId, "Project")
  };
}

export function parseJournalPage(
  searchParams: URLSearchParams,
  kind: JournalCursorKind
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
        ? decodeJournalCursor(cursorValues[0], kind)
        : null
  };
}

export function encodeJournalCursor(
  kind: JournalCursorKind,
  value: { createdAt: Date; id: string }
) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind,
      createdAt: value.createdAt.toISOString(),
      id: value.id
    }),
    "utf8"
  ).toString("base64url");
}

export function decodeJournalCursor(
  value: string,
  expectedKind: JournalCursorKind
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

    if (
      cursor.version !== 1 ||
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "The request body must be a JSON object."
    );
  }
  return value as Record<string, unknown>;
}

function parseRequiredString(
  value: unknown,
  emptyMessage: string,
  label: string,
  maxLength: number
) {
  if (typeof value !== "string") {
    throw new JournalRequestError("VALIDATION_ERROR", emptyMessage);
  }
  const text = value.trim();
  if (!text) {
    throw new JournalRequestError("VALIDATION_ERROR", emptyMessage);
  }
  if (text.length > maxLength) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`
    );
  }
  return text;
}

function parseOptionalString(
  value: unknown,
  label: string,
  maxLength: number
) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `${label} must be text.`
    );
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`
    );
  }
  return text;
}

function parseOptionalRelationshipId(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `${label} identifier must be text.`
    );
  }
  const id = value.trim();
  if (!id || id.length > 191) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `${label} identifier is invalid.`
    );
  }
  return id;
}

function parseJournalDate(value: unknown, now: Date, errorMessage: string) {
  if (value === undefined || value === null || value === "") {
    return startOfLocalDay(now);
  }
  if (typeof value !== "string") {
    throw new JournalRequestError("VALIDATION_ERROR", errorMessage);
  }
  const date = parseLocalDate(value);
  if (!date) {
    throw new JournalRequestError("VALIDATION_ERROR", errorMessage);
  }
  return date;
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
  if (typeof value !== "string" || !value.trim()) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Add a URL before saving this reference."
    );
  }
  const url = value.trim();
  if (url.length > MATERIAL_URL_MAX_LENGTH) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `Material URL must be ${MATERIAL_URL_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`
    );
  }

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
  if (typeof value !== "string") {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      "Material type is invalid."
    );
  }
  const type = value.trim().toLowerCase();
  if (!materialTypes.includes(type as MaterialType)) {
    throw new JournalRequestError(
      "VALIDATION_ERROR",
      `Material type must be one of: ${materialTypes.join(", ")}.`
    );
  }
  return type as MaterialType;
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
