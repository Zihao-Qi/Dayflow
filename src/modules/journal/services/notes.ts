import type { Note, Prisma } from "@prisma/client";
import { AppError } from "@/shared/kernel/errors";
import { journalErrors, parseStoredTags, type NoteCreateInput } from "../domain/journal";
import { readCollectionHistory, type JournalHistoryCriteria } from "./history";
import { resolveJournalAttribution } from "./relations";

export async function createNote(tx: Prisma.TransactionClient, input: NoteCreateInput) {
  try {
    const attribution = await resolveJournalAttribution(tx, input);
    return await tx.note.create({ data: {
      content: input.content, tags: JSON.stringify(input.tags), date: input.date,
      taskId: attribution.taskId, projectId: attribution.projectId
    } });
  } catch (error) { throw translateNotePersistenceError(error, "create"); }
}

export async function readNoteHistory(tx: Prisma.TransactionClient, criteria: JournalHistoryCriteria) {
  try {
    const page = await readCollectionHistory<Note>(tx, "note", criteria);
    return { ...page, items: page.items.map(note => ({ ...note, tags: parseStoredTags(note.tags) })) };
  } catch (error) { throw translateNotePersistenceError(error, "read"); }
}

/** Preserve the journal's internal-error contract for storage failures, including vanished relations. */
export function translateNotePersistenceError(error: unknown, operation: "create" | "read"): unknown {
  if (error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
      "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error &&
      (error.code === "P2003" || error.code === "P2025")) {
    return new AppError(operation === "create" ? journalErrors.theNoteCouldNotBeSaved : journalErrors.notesCouldNotBeLoaded, error);
  }
  // In particular P2002 reaches runOnce, which owns receipt races.
  return error;
}

/** No journal translation: the project-deletion workflow owns detach failures. */
export async function detachProjectNotes(tx: Prisma.TransactionClient, projectId: string) {
  await tx.note.updateMany({ where: { projectId }, data: { projectId: null } });
}

type NoteReadDatabase = { note: Pick<Prisma.TransactionClient["note"], "findMany"> };
type DateRange = { start: Date; end: Date };

// Keep stored tags here: each legacy read model retains its existing decoder.
export function readDayNotes(database: NoteReadDatabase, range: DateRange) {
  return database.note.findMany({ where: { date: { gte: range.start, lt: range.end } }, orderBy: { createdAt: "desc" } });
}

export function readProjectNotes(database: NoteReadDatabase, projectId: string, taskIds: string[]) {
  return database.note.findMany({ where: { OR: [{ projectId }, { taskId: { in: taskIds } }] }, orderBy: { createdAt: "desc" } });
}

export function readReviewNotes(database: NoteReadDatabase, range: DateRange) {
  return database.note.findMany({ where: { date: { gte: range.start, lt: range.end } }, select: { id: true } });
}
