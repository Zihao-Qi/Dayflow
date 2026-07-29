import { materialTypes } from "@/lib/journal-domain";

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
