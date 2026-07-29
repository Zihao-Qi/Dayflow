import assert from "node:assert/strict";
import test from "node:test";
import {
  isJournalMaterialRecord,
  isJournalNoteRecord
} from "../../src/lib/journal-records";

const note = {
  id: "note-1",
  content: "Decision context",
  tags: ["decision"],
  taskId: "task-1",
  projectId: null,
  date: "2026-07-29T12:00:00.000Z",
  createdAt: "2026-07-29T12:00:00.000Z"
};

const material = {
  id: "material-1",
  title: "Reference",
  url: "https://example.com/reference",
  type: "website",
  notes: "Supporting context",
  taskId: "task-1",
  noteId: "note-1",
  projectId: null,
  createdAt: "2026-07-29T12:00:00.000Z"
};

test("Journal Note records require canonical relationships and timestamps", () => {
  assert.equal(isJournalNoteRecord(note), true);
  assert.equal(isJournalNoteRecord({ ...note, taskId: 1 }), false);
  assert.equal(isJournalNoteRecord({ ...note, projectId: false }), false);
  assert.equal(isJournalNoteRecord({ ...note, date: "not-a-date" }), false);
  assert.equal(isJournalNoteRecord({ ...note, createdAt: "" }), false);
});

test("Journal Material records require canonical relationships, type, and timestamp", () => {
  assert.equal(isJournalMaterialRecord(material), true);
  assert.equal(isJournalMaterialRecord({ ...material, taskId: 1 }), false);
  assert.equal(isJournalMaterialRecord({ ...material, noteId: false }), false);
  assert.equal(isJournalMaterialRecord({ ...material, projectId: 2 }), false);
  assert.equal(
    isJournalMaterialRecord({ ...material, type: "unsupported" }),
    false
  );
  assert.equal(
    isJournalMaterialRecord({ ...material, createdAt: "not-a-date" }),
    false
  );
});
