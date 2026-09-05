import { parseLocalDate, startOfLocalDay } from "@/shared/kernel/calendar";
import { AppError, type ErrorSpec } from "@/shared/kernel/errors";
import {
  parseBoundedString,
  parseEnum,
  parseNullableLocalDate,
  parseRecordId,
  requireObject
} from "@/shared/kernel/parsing";

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

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as JournalRequestError };

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
  now: Date
): NoteCreateInput {
  const body = parseBodyObject(value);
  const content = parseRequiredString(
    body.content,
    "content",
    journalErrors.writeSomethingBeforeSavingThisNote.message,
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
    throw new AppError(journalErrors.provideOnlyOnePageLimit);
  }

  const rawLimit = limitValues[0];
  let limit = JOURNAL_PAGE_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      throw new AppError(journalErrors.pageLimitMustBeAPositiveWholeNumber);
    }
    limit = Math.min(Number(rawLimit), JOURNAL_PAGE_MAX_LIMIT);
  }

  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    throw new AppError(journalErrors.provideOnlyOnePaginationCursor);
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
  return encodeCursorText(
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
    )
  );
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

    const decoded = decodeCursorText(value);
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
    throw new AppError(journalErrors.thePaginationCursorIsInvalid);
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
    throw new AppError(journalErrors.noteTagsMustBeAnArrayOfTextValues);
  }
  if (value.length > NOTE_TAG_MAX_COUNT) {
    throw new AppError(journalErrors.aNoteCanHaveAtMost20Tags);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of value) {
    if (typeof rawTag !== "string") {
      throw new AppError(journalErrors.noteTagsMustContainOnlyTextValues);
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
      throw new AppError(journalErrors.eachNoteTagMustBe50CharactersOrFewer);
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
    journalErrors.addAURLBeforeSavingThisReference.message,
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
    throw new AppError(journalErrors.materialURLMustBeAValidHttpOrHttpsURL);
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
  return new AppError({ status: 400, code: "VALIDATION_ERROR", message });
}

function encodeCursorText(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursorText(text: string) {
  // Match Buffer's legacy decoder: discard a lone trailing sextet and retain
  // a leading BOM so JSON.parse rejects it rather than silently accepting it.
  const complete = text.length % 4 === 1 ? text.slice(0, -1) : text;
  const bytes = atob(complete.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    Uint8Array.from(bytes, character => character.charCodeAt(0))
  );
}


/** Exact envelopes owned by the journal boundary. The serializer emits exactly the declared properties. */
export const journalErrors = {
  provideOnlyOnePageLimit: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one page limit."
  },
  pageLimitMustBeAPositiveWholeNumber: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Page limit must be a positive whole number."
  },
  provideOnlyOnePaginationCursor: {
    status: 400,
    code: "INVALID_CURSOR",
    message: "Provide only one pagination cursor."
  },
  thePaginationCursorIsInvalid: {
    status: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is invalid."
  },
  noteTagsMustBeAnArrayOfTextValues: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Note tags must be an array of text values."
  },
  aNoteCanHaveAtMost20Tags: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "A note can have at most 20 tags."
  },
  noteTagsMustContainOnlyTextValues: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Note tags must contain only text values."
  },
  eachNoteTagMustBe50CharactersOrFewer: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Each note tag must be 50 characters or fewer."
  },
  materialURLMustBeAValidHttpOrHttpsURL: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Material URL must be a valid http or https URL."
  },
  provideOnlyOneJournalSearchQuery: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one Journal search query."
  },
  journalSearchMustBe200CharactersOrFewer: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Journal search must be 200 characters or fewer."
  },
  journalSearchCannotContainControlCharacters: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Journal search cannot contain control characters."
  },
  provideOnlyOneNoteTagFilter: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one Note tag filter."
  },
  tagFilteringIsAvailableOnlyForNotes: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Tag filtering is available only for Notes."
  },
  theLinkedTaskCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked task could not be found."
  },
  theLinkedProjectCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked project could not be found."
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    code: "ATTRIBUTION_CONFLICT",
    message: "The selected task belongs to a different project."
  },
  theLinkedNoteCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked note could not be found."
  },
  theSelectedNoteBelongsToADifferentProject: {
    status: 409,
    code: "ATTRIBUTION_CONFLICT",
    message: "The selected note belongs to a different project."
  },
  requestBodyMustBeValidJSON: {
    status: 400,
    code: "INVALID_JSON",
    message: "Request body must be valid JSON."
  },
  xDayflowMutationIdMustContain1To128Characters: {
    status: 400,
    code: "INVALID_MUTATION_ID",
    message: "X-Dayflow-Mutation-Id must contain 1 to 128 characters."
  },
  thisMutationIdentifierWasAlreadyUsedForADifferentRequest: {
    status: 409,
    code: "MUTATION_ID_CONFLICT",
    message: "This mutation identifier was already used for a different request."
  },
  theSavedMutationReceiptCouldNotBeRead: {
    status: 500,
    code: "INVALID_MUTATION_RECEIPT",
    message: "The saved mutation receipt could not be read."
  },
  notesCouldNotBeLoaded: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Notes could not be loaded."
  },
  referencesCouldNotBeLoaded: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "References could not be loaded."
  },
  theNoteCouldNotBeSaved: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The note could not be saved."
  },
  theReferenceCouldNotBeSaved: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The reference could not be saved."
  },
  writeSomethingBeforeSavingThisNote: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Write something before saving this note."
  },
  addAURLBeforeSavingThisReference: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Add a URL before saving this reference."
  }
} as const satisfies Record<string, ErrorSpec>;

/** Receipt semantics belong to idempotency; Journal owns its code-first variants. */
export function journalAppError(error: AppError): AppError {
  switch (error.code) {
    case "INVALID_MUTATION_ID": return new AppError(journalErrors.xDayflowMutationIdMustContain1To128Characters, error);
    case "MUTATION_ID_CONFLICT": return new AppError(journalErrors.thisMutationIdentifierWasAlreadyUsedForADifferentRequest, error);
    case "INVALID_MUTATION_RECEIPT": return new AppError(journalErrors.theSavedMutationReceiptCouldNotBeRead, error);
    default: return error;
  }
}


export type JournalNoteRecord = {
  id: string;
  content: string;
  tags: string[];
  taskId: string | null;
  projectId: string | null;
  date: string;
  createdAt: string;
};

export type JournalMaterialRecord = {
  id: string;
  title: string;
  url: string;
  type: string;
  notes: string;
  taskId: string | null;
  noteId: string | null;
  projectId: string | null;
  createdAt: string;
};

export type JournalHistoryPage<T> = {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
};

export function isJournalHistoryPage<T>(
  value: unknown,
  isItem: (item: unknown) => item is T
): value is JournalHistoryPage<T> {
  if (!value || typeof value !== "object") return false;
  const page = value as {
    items?: unknown;
    nextCursor?: unknown;
    totalCount?: unknown;
  };
  return (
    Array.isArray(page.items) &&
    page.items.every(isItem) &&
    (page.nextCursor === null || typeof page.nextCursor === "string") &&
    Number.isInteger(page.totalCount) &&
    Number(page.totalCount) >= 0
  );
}

export function isJournalNoteRecord(
  value: unknown
): value is JournalNoteRecord {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<JournalNoteRecord>;
  return (
    typeof note.id === "string" &&
    typeof note.content === "string" &&
    Array.isArray(note.tags) &&
    note.tags.every((tag) => typeof tag === "string") &&
    (note.taskId === null || typeof note.taskId === "string") &&
    (note.projectId === null || typeof note.projectId === "string") &&
    typeof note.date === "string" &&
    Number.isFinite(Date.parse(note.date)) &&
    typeof note.createdAt === "string" &&
    Number.isFinite(Date.parse(note.createdAt))
  );
}

export function isJournalMaterialRecord(
  value: unknown
): value is JournalMaterialRecord {
  if (!value || typeof value !== "object") return false;
  const material = value as Partial<JournalMaterialRecord>;
  return (
    typeof material.id === "string" &&
    typeof material.title === "string" &&
    typeof material.url === "string" &&
    typeof material.type === "string" &&
    typeof material.notes === "string" &&
    (material.taskId === null || typeof material.taskId === "string") &&
    (material.noteId === null || typeof material.noteId === "string") &&
    (material.projectId === null || typeof material.projectId === "string") &&
    materialTypes.includes(material.type as (typeof materialTypes)[number]) &&
    typeof material.createdAt === "string" &&
    Number.isFinite(Date.parse(material.createdAt))
  );
}

export function parseSearchText(searchParams: URLSearchParams) {
  const values = searchParams.getAll("q");
  if (values.length > 1) {
    throw new AppError(journalErrors.provideOnlyOneJournalSearchQuery);
  }
  const text = (values[0] ?? "").normalize("NFKC").trim();
  if (text.length > JOURNAL_SEARCH_MAX_LENGTH) {
    throw new AppError(journalErrors.journalSearchMustBe200CharactersOrFewer);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new AppError(journalErrors.journalSearchCannotContainControlCharacters);
  }
  return text;
}

export function parseTagFilter(
  searchParams: URLSearchParams,
  kind: JournalCursorKind
) {
  const values = searchParams.getAll("tag");
  if (values.length > 1) {
    throw new AppError(journalErrors.provideOnlyOneNoteTagFilter);
  }
  if (kind === "material" && values.length > 0) {
    throw new AppError(journalErrors.tagFilteringIsAvailableOnlyForNotes);
  }
  if (values.length === 0) return null;
  return normalizeNoteTags([values[0]])[0] ?? null;
}

export function journalLiteralLikePattern(text: string) {
  return `%${text.replace(/[!%_]/g, "!$&")}%`;
}
