# Journal Search & Filtering v1

Status: Implemented
Date: July 29, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for Notes and References as persisted Evidence.
>
> **Reliability contract:**
> [Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md) remains
> authoritative for typed responses, complete history, and honest failure
> states.
>
> **Relationship contract:**
> [Journal Relationships v1](./JOURNAL_RELATIONSHIPS_V1.md) remains
> authoritative for Task, Note, and Project attribution.

## Purpose

Journal capture and relationships are only useful over time if older Evidence
can be found without loading and scanning every page by hand. Journal Search &
Filtering v1 adds complete-history retrieval to the existing Note and Reference
history routes and gives both Journal views a small, dependable search
interface.

Search remains a read-only view over canonical Evidence. It does not rewrite
content, infer relationships, rank importance, or turn absent results into
evidence that nothing happened.

## Scope

- Search complete persisted Note history by Note content.
- Filter Notes by one exact canonical tag.
- Combine Note text and tag criteria with `AND`.
- Search complete persisted Reference history across title, URL, and notes.
- Keep deterministic newest-first pagination for filtered results.
- Keep filtered result state separate from the unfiltered Note history used by
  the Reference relationship picker.
- Reject stale browser responses when a newer query is active.
- Preserve existing unfiltered route and Journal behavior.
- Keep controls and result pagination usable on phone.

## Query Contract

The existing history routes accept these optional query parameters:

```text
GET /api/notes?q=<text>&tag=<tag>&limit=<n>&cursor=<opaque>
GET /api/materials?q=<text>&limit=<n>&cursor=<opaque>
```

### Text

- `q` is a literal substring query.
- It is Unicode NFKC-normalized and trimmed.
- An empty normalized value means no text criterion.
- It may contain at most 200 characters.
- Control characters are rejected.
- `%`, `_`, and `\` are ordinary query characters, not SQL wildcards.
- Matching uses SQLite `NOCASE` behavior: ASCII case is folded while other
  Unicode behavior remains the storage adapter's literal behavior.
- Notes search `content`.
- References search `title`, `url`, or `notes`; those fields combine with
  `OR`.
- Note tags, Task names, Project names, and linked Note content are not
  implicitly searched.

### Note tag

- `tag` is available only on the Note route.
- One tag may be selected in v1.
- It is canonicalized through the same normalization used by Note creation:
  leading `#` is removed, surrounding whitespace is trimmed, internal
  whitespace becomes `-`, and text becomes lowercase.
- An empty normalized value means no tag criterion.
- Membership is exact. `design` does not match `design-systems`.
- Stored tags are interpreted as a JSON array. Malformed legacy tag storage is
  treated as an empty array rather than breaking all search.
- A Note text criterion and tag criterion combine with `AND`.
- Supplying `tag` to the Reference route is a typed validation failure.

### Scalar parameters

- At most one value may be supplied for each of `q`, `tag`, `limit`, and
  `cursor`.
- Existing positive whole-number limit parsing remains unchanged.
- Limits remain capped at 100 records and default to 50.
- Unknown parameters remain ignored for compatibility; they do not create
  hidden facets.

## Result and Pagination Invariants

1. **Complete persisted history.** Search executes against stored Notes or
   References, not the bootstrap preview or currently loaded browser pages.
2. **Read-only retrieval.** Search never creates, updates, deletes, or
   attributes Evidence.
3. **Stable ordering.** Results always order by `createdAt DESC, id DESC`.
   There is no relevance ordering.
4. **Matching count.** `totalCount` counts the complete matching result set,
   independent of the current page.
5. **Matching cursor.** `nextCursor` anchors the final emitted matching
   `(createdAt, id)` pair and is present only when another match exists.
6. **Unfiltered compatibility.** With no effective `q` or `tag`, response
   records, ordering, count, limits, and version-1 pagination behavior remain
   unchanged.
7. **Query-bound filtered cursors.** A filtered cursor carries an opaque digest
   of the canonical collection and criteria. Reusing it for another collection
   or criterion fails with `INVALID_CURSOR`.
8. **No snapshot claim.** New Evidence between page requests may change
   `totalCount`. Existing older matches are still traversed by the stable
   keyset order.
9. **Response compatibility.** Successful responses retain the existing
   shape:

   ```ts
   {
     items: JournalRecord[];
     nextCursor: string | null;
     totalCount: number;
   }
   ```

## Browser Interaction

### Notes

- `Search Notes` filters by content after a short debounce.
- `Filter by tag` accepts a tag using the canonical rules above.
- Visible Note tags are buttons that apply that exact tag filter.
- `Clear filters` restores unfiltered Note history.
- Text and tag values remain visible while loading, after an error, and while
  another Journal destination is open.

### References

- `Search References` searches title, URL, and notes after a short debounce.
- `Clear search` restores unfiltered Reference history.

### Results

- Changing criteria immediately invalidates the prior result generation and
  clears mismatched visible items.
- The prior request is aborted when possible.
- Generation identity, not abort behavior alone, determines whether a response
  may update the view.
- A stale success, stale error, or stale malformed response is ignored.
- `Load more` keeps the active criteria and appends unique records.
- An append failure keeps already accepted results and its cursor retryable.
- Search failure is shown as an actionable error; it is never presented as
  “no matches.”
- A successful empty page uses criterion-aware empty copy.
- Search criteria never alter either Note or Reference capture drafts.

## Relationship-Picker Independence

The Reference form's linked-Note picker must continue to reach complete,
unfiltered Note history:

- The filtered Notes result session is not reused as the picker session.
- The picker owns a separate unfiltered Note history session.
- Loading older relationship options never changes the visible Note search.
- Filtering Notes never removes a valid Note relationship option.

This separation is required by Journal Relationships v1 complete Note
reachability.

## Typed Failures

Existing `{ code, error }` response bodies remain authoritative:

- `400 VALIDATION_ERROR`
  - duplicate text or tag parameters;
  - text longer than 200 characters or containing control characters;
  - invalid canonical tag;
  - any tag parameter on the Reference route;
  - existing invalid page-limit cases.
- `400 INVALID_CURSOR`
  - malformed or unsupported cursor;
  - cursor from another collection;
  - filtered cursor whose canonical query digest does not match.
- `500 INTERNAL_ERROR`
  - an unexpected storage failure, using the existing collection-specific
    generic message without database details.

## Persistence and Performance

- No schema migration is required.
- V1 uses parameterized SQLite queries through Prisma.
- Exact Note tags use SQLite JSON membership rather than a serialized-string
  prefix or substring.
- Literal text search escapes SQL wildcard characters.
- Search is an `O(N)` local scan in v1. Dayflow does not add SQLite FTS or a
  normalized tag table before real local history demonstrates the need.
- A future storage optimization must remain behind the same route and browser
  interfaces.

## Non-Goals

- Relevance ranking, fuzzy matching, stemming, or result highlighting.
- Multiple tag filters or tag `OR` expressions.
- Relationship, Project, Task, Note-provenance, or date facets.
- Searching Diary or Review writing.
- Searching Reference linked-Note content.
- Editing or deleting Notes and References.
- Saved searches, recent-search history, or URL-synchronized filters.
- SQLite FTS, a normalized tag table, or a hosted search service.

## Acceptance Criteria

1. A Note content match older than the first 100 records is reachable.
2. One exact canonical Note tag filters complete history.
3. Note text and tag filters combine with `AND`.
4. A Reference can match by title, URL, or notes.
5. `%`, `_`, and `\` remain literal search characters.
6. Filtered totals and newest-first pagination are correct.
7. A filtered cursor cannot be reused for another query.
8. Unfiltered history remains backward-compatible.
9. Quickly changing a query cannot let an older response replace newer
   results.
10. A failed search is retryable and is not displayed as an empty result.
11. Filtering Notes does not restrict Reference linked-Note choices.
12. Search does not change capture drafts or persisted record counts.
13. Search controls and results do not overflow a phone viewport.

## Required Coverage

- Unit coverage for text/tag parsing, bounds, literal wildcard escaping, and
  query-bound cursor validation.
- Route coverage through disposable SQLite for complete-history Note and
  Reference matching, exact tag membership, combined criteria, ordering,
  matching counts, typed failures, and unchanged unfiltered responses.
- Browser coverage for filter controls, tag-button handoff, pagination,
  out-of-order response rejection, retry, relationship-picker independence,
  capture-draft independence, and phone usability.
- The complete reliability, migration, backup, production-build, and Chromium
  gates remain mandatory.

## Implementation Record

Implemented July 29, 2026.

- Note and Reference history routes share strict search criteria parsing,
  literal SQLite matching, filtered totals, stable keyset pagination, and
  query-bound cursors without a schema migration.
- Notes support complete-history content search and one exact canonical tag;
  References search title, URL, and notes through the existing response shape.
- The Journal uses independent Note, Reference, and unfiltered linked-Note
  sessions with debouncing, aborts, generation checks, strict response
  decoding, exact retry replay, and create reconciliation that preserves loaded
  history depth.
- Unit and disposable-SQLite route coverage verify canonical parsing, literal
  wildcard behavior, legacy tag safety, matching fields, stable ordering,
  cursor scope, typed failures, and unfiltered compatibility.
- Browser coverage verifies complete-history filtering and pagination,
  tag-button handoff, stale-response rejection, exact retry recovery,
  relationship-picker independence, create reconciliation, draft independence,
  and phone usability.
- The complete `npm run check` reliability gate passed on July 29, 2026:
  137 unit tests, 13 backup/integration tests, all migration fixtures, the
  production build, and 95 Chromium browser tests.
