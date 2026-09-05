import type {
  JournalMaterialRecord,
  JournalNoteRecord
} from "@/lib/journal-records";

export type JournalView = "daily" | "notes" | "references";

export type Note = JournalNoteRecord;

export type Material = JournalMaterialRecord;

export type JournalTaskOption = {
  id: string;
  title: string;
  projectId: string | null;
};

export type Diary = {
  id: string | null;
  date: string;
  content: string;
  reflection: string;
  mood: number;
  energy: number;
  persisted: boolean;
};

export type NoteCaptureDraft = {
  content: string;
  tags: string;
  taskId: string;
  projectId: string;
};

export type MaterialCaptureDraft = {
  title: string;
  url: string;
  notes: string;
  taskId: string;
  noteId: string;
  projectId: string;
};

export function taskProjectIdFor(
  taskId: string,
  tasks: JournalTaskOption[]
): string | null {
  return tasks.find(({ id }) => id === taskId)?.projectId ?? null;
}

export function diariesEqual(left: Diary, right: Diary) {
  return (
    left.id === right.id &&
    left.persisted === right.persisted &&
    left.date === right.date &&
    left.content === right.content &&
    left.reflection === right.reflection &&
    left.mood === right.mood &&
    left.energy === right.energy
  );
}

export function mergeJournalRecords<
  T extends { id: string; createdAt: string }
>(...collections: T[][]) {
  const byId = new Map<string, T>();
  for (const item of collections.flat()) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id)
  );
}
