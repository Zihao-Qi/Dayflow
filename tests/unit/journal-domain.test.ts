import { frozenClock } from "../../src/shared/kernel/calendar";
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeJournalCursor,
  encodeJournalCursor,
  inferMaterialTitle,
  inferMaterialType,
  JOURNAL_PAGE_MAX_LIMIT,
  JournalRequestError,
  normalizeNoteTags,
  parseJournalPage,
  parseMaterialCreateInput,
  parseNoteCreateInput
} from "../../src/lib/journal-domain";

test("Note input requires content and normalizes bounded tags", () => {
  assert.throws(
    () => parseNoteCreateInput({ content: "   " }, testClock.now()),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );

  const note = parseNoteCreateInput(
    {
      content: "  Keep the draft  ",
      tags: [" Product ", "#Design Systems", "product", ""],
      date: "2026-07-27",
      taskId: " task-1 ",
      projectId: " project-1 "
    },
    new Date("2026-07-01T12:00:00-05:00")
  );

  assert.equal(note.content, "Keep the draft");
  assert.deepEqual(note.tags, ["product", "design-systems"]);
  assert.equal(note.taskId, "task-1");
  assert.equal(note.projectId, "project-1");
  assert.equal(note.date.getFullYear(), 2026);
  assert.equal(note.date.getMonth(), 6);
  assert.equal(note.date.getDate(), 27);
});

test("Note tag normalization is shared by browser and mutation parsing", () => {
  assert.deepEqual(
    normalizeNoteTags([" #Decisions ", "Design systems", "decisions"]),
    ["decisions", "design-systems"]
  );
});

test("Material input validates URL and type while preserving the entered URL", () => {
  assert.throws(
    () => parseMaterialCreateInput({ url: "javascript:alert(1)" }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () =>
      parseMaterialCreateInput({
        url: "https://example.com",
        type: "executable"
      }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );

  const material = parseMaterialCreateInput({
    url: " https://www.youtube.com/watch?v=example ",
    title: "",
    notes: " Watch later ",
    taskId: " task-1 ",
    noteId: " note-1 ",
    projectId: " project-1 "
  });
  assert.equal(material.url, "https://www.youtube.com/watch?v=example");
  assert.equal(material.type, "youtube");
  assert.equal(material.title, "YouTube material");
  assert.equal(material.notes, "Watch later");
  assert.equal(material.taskId, "task-1");
  assert.equal(material.noteId, "note-1");
  assert.equal(material.projectId, "project-1");
  assert.equal(inferMaterialType(material.url), "youtube");
  assert.equal(inferMaterialTitle(material.type), "YouTube material");
});

test("Journal cursors round trip and cannot cross collection types", () => {
  const createdAt = new Date("2026-07-27T17:25:31.123Z");
  const encoded = encodeJournalCursor("note", {
    createdAt,
    id: "note_123"
  });

  assert.deepEqual(decodeJournalCursor(encoded, "note"), {
    createdAt,
    id: "note_123"
  });
  assert.throws(
    () => decodeJournalCursor(encoded, "material"),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "INVALID_CURSOR"
  );
});

test("filtered Journal cursors are bound to one canonical query scope", () => {
  const createdAt = new Date("2026-07-27T17:25:31.123Z");
  const encoded = encodeJournalCursor(
    "note",
    { createdAt, id: "note_123" },
    "scope-a"
  );

  assert.deepEqual(decodeJournalCursor(encoded, "note", "scope-a"), {
    createdAt,
    id: "note_123"
  });
  for (const scope of ["", "scope-b"]) {
    assert.throws(
      () => decodeJournalCursor(encoded, "note", scope),
      (error) =>
        error instanceof JournalRequestError &&
        error.code === "INVALID_CURSOR"
    );
  }

  const unfiltered = encodeJournalCursor("note", {
    createdAt,
    id: "note_123"
  });
  assert.throws(
    () => decodeJournalCursor(unfiltered, "note", "scope-a"),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "INVALID_CURSOR"
  );
});

test("Journal page parsing caps large limits and rejects ambiguous input", () => {
  const capped = parseJournalPage(
    new URLSearchParams({ limit: "10000" }),
    "note"
  );
  assert.equal(capped.limit, JOURNAL_PAGE_MAX_LIMIT);

  assert.throws(
    () => parseJournalPage(new URLSearchParams("limit=10&limit=20"), "note"),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => parseJournalPage(new URLSearchParams({ limit: "0" }), "note"),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => parseJournalPage(new URLSearchParams({ cursor: "" }), "note"),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "INVALID_CURSOR"
  );
});

const testClock = frozenClock(new Date("2026-07-27T12:00:00-05:00"));
