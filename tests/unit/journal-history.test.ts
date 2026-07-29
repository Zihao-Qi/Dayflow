import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  journalLiteralLikePattern,
  parseJournalHistoryCriteria,
  readJournalHistory
} from "../../src/lib/journal-history";
import {
  JOURNAL_SEARCH_MAX_LENGTH,
  JournalRequestError
} from "../../src/lib/journal-domain";

const unreachableDatabase = {} as PrismaClient;

test("Journal history canonicalizes successful text and tag criteria", () => {
  const criteria = parseJournalHistoryCriteria(
    new URLSearchParams({
      q: "  ＮＥＥＤＬＥ  ",
      tag: "  #Design   Systems  "
    }),
    "note"
  );

  assert.equal(criteria.text, "NEEDLE");
  assert.equal(criteria.tag, "design-systems");
  assert.notEqual(criteria.scope, "");
  assert.equal(criteria.limit, 50);
  assert.equal(criteria.cursor, null);

  const empty = parseJournalHistoryCriteria(
    new URLSearchParams({ q: "  ", tag: " ## " }),
    "note"
  );
  assert.equal(empty.text, "");
  assert.equal(empty.tag, null);
  assert.equal(empty.scope, "");
});

test("Journal LIKE patterns keep wildcard and escape characters literal", () => {
  assert.equal(journalLiteralLikePattern("%_\\!"), "%!%!_\\!!%");
});

test("Journal history rejects ambiguous and unsupported search parameters before storage", async () => {
  for (const [kind, params, message] of [
    [
      "note",
      new URLSearchParams("q=one&q=two"),
      "Provide only one Journal search query."
    ],
    [
      "note",
      new URLSearchParams("tag=one&tag=two"),
      "Provide only one Note tag filter."
    ],
    [
      "material",
      new URLSearchParams("tag="),
      "Tag filtering is available only for Notes."
    ]
  ] as const) {
    await assert.rejects(
      kind === "note"
        ? readJournalHistory(unreachableDatabase, "note", params)
        : readJournalHistory(unreachableDatabase, "material", params),
      (error) =>
        error instanceof JournalRequestError &&
        error.code === "VALIDATION_ERROR" &&
        error.status === 400 &&
        error.message === message
    );
  }
});

test("Journal search text is bounded and rejects control characters before storage", async () => {
  for (const [q, message] of [
    [
      "x".repeat(JOURNAL_SEARCH_MAX_LENGTH + 1),
      `Journal search must be ${JOURNAL_SEARCH_MAX_LENGTH} characters or fewer.`
    ],
    [
      "unsafe\u0000query",
      "Journal search cannot contain control characters."
    ]
  ] as const) {
    await assert.rejects(
      readJournalHistory(
        unreachableDatabase,
        "note",
        new URLSearchParams({ q })
      ),
      (error) =>
        error instanceof JournalRequestError &&
        error.code === "VALIDATION_ERROR" &&
        error.status === 400 &&
        error.message === message
    );
  }
});
