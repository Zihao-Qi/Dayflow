import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeJournalCursor,
  encodeJournalCursor,
  JOURNAL_PAGE_MAX_LIMIT,
  JournalRequestError,
  parseJournalPage,
  parseMaterialCreateInput,
  parseNoteCreateInput
} from "../../src/lib/journal-domain";

test("Note input requires content and normalizes bounded tags", () => {
  assert.throws(
    () => parseNoteCreateInput({ content: "   " }),
    (error) =>
      error instanceof JournalRequestError &&
      error.code === "VALIDATION_ERROR"
  );

  const note = parseNoteCreateInput(
    {
      content: "  Keep the draft  ",
      tags: [" Product ", "#Design Systems", "product", ""],
      date: "2026-07-27"
    },
    new Date("2026-07-01T12:00:00-05:00")
  );

  assert.equal(note.content, "Keep the draft");
  assert.deepEqual(note.tags, ["product", "design-systems"]);
  assert.equal(note.date.getFullYear(), 2026);
  assert.equal(note.date.getMonth(), 6);
  assert.equal(note.date.getDate(), 27);
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
    notes: " Watch later "
  });
  assert.equal(material.url, "https://www.youtube.com/watch?v=example");
  assert.equal(material.type, "youtube");
  assert.equal(material.title, "YouTube material");
  assert.equal(material.notes, "Watch later");
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
