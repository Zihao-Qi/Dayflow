import type { Material, Note, PrismaClient } from "@prisma/client";
import { appErrorResponse } from "@/lib/http-errors";
import { journalAppError, journalErrors, type JournalCursorKind, type JournalHistoryPage } from "@/modules/journal/domain/journal";
import { readNoteHistory, translateNotePersistenceError } from "@/modules/journal/services/notes";
import { readMaterialHistory, translateMaterialPersistenceError } from "@/modules/journal/services/materials";
import { parseJournalHistoryCriteria } from "@/modules/journal/services/history";
import { AppError, type ErrorSpec } from "@/shared/kernel/errors";

export { createNote, readDayNotes, readProjectNotes, readReviewNotes } from "@/modules/journal/services/notes";
export { createMaterial, readRecentMaterials, readProjectMaterials, readReviewMaterials } from "@/modules/journal/services/materials";
export { resolveJournalAttribution, resolveMaterialRelations, type JournalAttribution } from "@/modules/journal/services/relations";
export { parseJournalHistoryCriteria } from "@/modules/journal/services/history";
export { journalLiteralLikePattern } from "@/modules/journal/domain/journal";

type NoteHistoryRecord = Omit<Note, "tags"> & { tags: string[] };
export function readJournalHistory(database: PrismaClient, kind: "note", searchParams: URLSearchParams): Promise<JournalHistoryPage<NoteHistoryRecord>>;
export function readJournalHistory(database: PrismaClient, kind: "material", searchParams: URLSearchParams): Promise<JournalHistoryPage<Material>>;
export async function readJournalHistory(database: PrismaClient, kind: JournalCursorKind, searchParams: URLSearchParams) {
  // Validate before opening storage, preserving errors even when storage is unavailable.
  const criteria = parseJournalHistoryCriteria(searchParams, kind);
  return database.$transaction(async tx => kind === "note"
    ? readNoteHistory(tx, criteria)
    : readMaterialHistory(tx, criteria));
}

export function journalErrorResponse(error: unknown, fallback: ErrorSpec) {
  // The same operation-local translation covers failures raised while committing.
  const translated = fallback === journalErrors.theNoteCouldNotBeSaved ? translateNotePersistenceError(error, "create")
    : fallback === journalErrors.notesCouldNotBeLoaded ? translateNotePersistenceError(error, "read")
      : fallback === journalErrors.theReferenceCouldNotBeSaved ? translateMaterialPersistenceError(error, "create")
        : fallback === journalErrors.referencesCouldNotBeLoaded ? translateMaterialPersistenceError(error, "read") : error;
  if (translated instanceof AppError) return appErrorResponse(journalAppError(translated));
  console.error(fallback.message, error);
  return appErrorResponse(new AppError(fallback, error));
}
