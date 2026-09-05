import { localDateKey } from "@/lib/dates";
import { inferMaterialTitle, inferMaterialType } from "@/lib/journal-domain";
import { request } from "@/shared/client/api-client";
import {
  isJournalHistoryPage,
  isJournalMaterialRecord as isMaterialResponse,
  isJournalNoteRecord as isNoteResponse,
  isPersistedDiaryResponse,
  stringArraysEqual,
  type Diary,
  type JournalHistoryPage,
  type JournalMaterialRecord,
  type JournalNoteRecord
} from "./journal-model";

export function createNote(payload: {
  content: string;
  tags: string[];
  taskId: string | null;
  projectId: string | null;
}, mutationId: string, expectedProjectId: string | null, todayKey: string | undefined) {
  return request("/api/notes", {
    method: "POST",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is JournalNoteRecord => !(!isNoteResponse(result) ||
      result.content !== payload.content ||
      !stringArraysEqual(result.tags, payload.tags) ||
      result.taskId !== payload.taskId ||
      result.projectId !== expectedProjectId ||
      !todayKey ||
      localDateKey(new Date(result.date)) !== todayKey),
    fallback: "The note could not be saved. Your draft is still here.",
  });
}

export function createMaterial(payload: {
  title: string;
  url: string;
  notes: string;
  taskId: string | null;
  noteId: string | null;
  projectId: string | null;
}, mutationId: string, expectedProjectId: string | null) {
  return request("/api/materials", {
    method: "POST",
    body: payload,
    mutationId: mutationId,
    decode: (result): result is JournalMaterialRecord => !(!isMaterialResponse(result) ||
      result.url !== payload.url ||
      result.title !==
        (payload.title ||
          inferMaterialTitle(inferMaterialType(payload.url))) ||
      result.type !== inferMaterialType(payload.url) ||
      result.notes !== payload.notes ||
      result.taskId !== payload.taskId ||
      result.noteId !== payload.noteId ||
      result.projectId !== expectedProjectId),
    fallback: "The reference could not be saved. Your draft is still here.",
  });
}

export function saveDiary(diary: Diary) {
  return request("/api/diary", {
    method: "PUT",
    body: diary,
    decode: (result): result is Diary & {
      id: string;
      persisted: true;
    } => !(!isPersistedDiaryResponse(result) ||
      result.date !== diary.date ||
      result.content !== diary.content ||
      result.reflection !== diary.reflection ||
      result.mood !== diary.mood ||
      result.energy !== diary.energy),
    fallback: "Couldn’t save the journal. Your writing is still here — retry.",
  });
}

export const journalHistoryMessages = {
  note: "Note history could not be loaded.",
  material: "Reference history could not be loaded."
} as const;

export function loadJournalHistory(
  kind: "note" | "material",
  searchParams: URLSearchParams,
  signal: AbortSignal
) {
  const endpoint = kind === "note" ? "/api/notes" : "/api/materials";
  const isRecord: (value: unknown) => value is JournalNoteRecord | JournalMaterialRecord =
    kind === "note" ? isNoteResponse : isMaterialResponse;
  return request(`${endpoint}?${searchParams.toString()}`, {
    cache: "no-store",
    signal,
    decode: (result): result is JournalHistoryPage<JournalNoteRecord | JournalMaterialRecord> =>
      isJournalHistoryPage(result, isRecord),
    fallback: journalHistoryMessages[kind]
  });
}
