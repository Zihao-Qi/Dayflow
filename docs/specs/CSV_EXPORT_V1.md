# CSV Export v1

Status: Implemented
Date: July 28, 2026
Scope: Complete, human-friendly Task and Activity history downloads

## Purpose

Dayflow already provides a lossless database backup and a complete, versioned
JSON export for agents. People also need a simple way to inspect and analyze
their Task and Activity history in spreadsheet and data-analysis tools.

CSV Export v1 adds two deliberately supplemental downloads without weakening
the backup contract or turning CSV into an import format.

This specification extends
[Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md) and
[Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md). Those specifications
remain authoritative where this document does not add a more specific rule.

## Goals

- Export complete Task history as one CSV document.
- Export complete Activity history as one CSV document.
- Keep stable, documented columns and deterministic row ordering.
- Preserve identifiers needed to relate exported records.
- Include human-readable Task, Project, and Phase names where useful.
- Make Activity timestamps useful in both exact UTC and local wall-clock form.
- Prevent user-authored cells from being interpreted as spreadsheet formulas.
- Preserve Unicode, commas, quotes, and line breaks through standard CSV
  escaping.
- Expose downloads from the existing Data & backups workflow.
- Return errors instead of a file when an export cannot be completed.

## Non-Goals

- Replacing Dayflow's checksummed backup and restore format.
- Importing or restoring from CSV.
- Exporting every Dayflow table in CSV form.
- Combining Tasks and Activities into one denormalized document.
- User-selected columns, date filters, delimiters, or encodings.
- Background export jobs, archives, or scheduled exports.
- Locale-specific numeric or date formatting.
- Claiming that CSV preserves every database implementation detail.

## Canonical Terms

### CSV Export

A CSV Export is a complete, read-only analysis document for one supported
record kind. It is supplemental and is not a backup.

### Export Kind

CSV Export v1 supports exactly two kinds:

- `tasks`
- `activities`

### Formula Safety

Spreadsheet applications may execute cells beginning with formula control
characters. Dayflow prefixes a single apostrophe to a string cell when its
first non-control/space character is `=`, `+`, `-`, or `@`. The apostrophe is
part of the CSV value and deliberately makes the analysis document safer than a
byte-for-byte text export. Lossless text remains available through JSON export
and database backup.

## Invariants

1. **Complete history.** Each export queries every persisted record of its kind
   and never uses the dashboard bootstrap window.
2. **Read-only.** Exporting does not create, update, or delete user records.
3. **One kind per document.** A response contains either Tasks or Activities,
   never a mixed table.
4. **Stable version.** v1 responses identify format `dayflow-csv`, version `1`,
   and the selected export kind in response headers.
5. **Stable columns.** Column names and order are fixed by this specification.
6. **Deterministic rows.** Tasks sort by creation timestamp then identifier.
   Activities sort by start timestamp then identifier.
7. **UTF-8.** Documents are UTF-8 and start with a UTF-8 byte-order mark for
   common spreadsheet compatibility.
8. **Standard records.** Rows use comma separators and CRLF record endings.
9. **Escaped cells.** Quotes are doubled and cells containing commas, quotes,
   CR, or LF are enclosed in double quotes.
10. **Formula-safe strings.** User-authored and relationship-name strings are
    neutralized before CSV escaping.
11. **Explicit absence.** `null` and absent optional values become empty cells;
    zero and `false` remain explicit values.
12. **Canonical numbers.** Whole numbers use ungrouped base-10 text.
13. **Canonical UTC.** Exact timestamps use ISO 8601 UTC text.
14. **Calendar honesty.** Task schedule and deadline values use local
    `YYYY-MM-DD` calendar keys. Activities include exact UTC plus local date,
    local `HH:mm`, and the exporter process's IANA time-zone identifier.
15. **No partial success.** Query or serialization failure returns a typed JSON
    error without CSV content-disposition headers.
16. **Confirmed browser download.** The UI triggers a file download only after
    validating a successful CSV response and canonical filename.
17. **No cache.** CSV responses use `Cache-Control: no-store`.

## Deep Module and Interface

CSV rules belong behind one module interface:

```ts
createCsvExport(kind, now?, database?)
```

Callers choose only the export kind. The module owns complete retrieval,
relations, ordering, headers, formula safety, escaping, local-time
representation, filenames, and response metadata. The production database and
an in-memory test adapter share the same seam.

The HTTP route is a thin transport adapter. It parses the path, calls the
module, and maps the result into download headers.

## HTTP Interface

`GET /api/exports/:kind`

Supported paths:

- `/api/exports/tasks`
- `/api/exports/activities`

Successful response:

- status `200`;
- `Content-Type: text/csv; charset=utf-8`;
- `Content-Disposition: attachment; filename="<canonical filename>"`;
- `Cache-Control: no-store`;
- `X-Content-Type-Options: nosniff`;
- `X-Dayflow-Export-Format: dayflow-csv`;
- `X-Dayflow-Export-Version: 1`;
- `X-Dayflow-Export-Kind: tasks|activities`;
- `X-Dayflow-Record-Count: <whole number>`;
- `X-Dayflow-File-Name: <canonical filename>`.

Canonical filenames:

- `dayflow-tasks-YYYY-MM-DD.csv`
- `dayflow-activities-YYYY-MM-DD.csv`

The filename date is the local calendar date when the export is created.

Typed failures:

- unsupported kind: `404 EXPORT_NOT_FOUND`;
- unexpected retrieval or serialization failure: `500 INTERNAL_ERROR`.

Failure responses are JSON and do not include attachment headers.

## Task Columns

Task CSV columns, in order:

1. `task_id`
2. `title`
3. `status`
4. `priority`
5. `scheduled_date`
6. `deadline_date`
7. `estimate_minutes`
8. `legacy_actual_minutes`
9. `urgent_score`
10. `importance_score`
11. `sort_order`
12. `focus_queue_position`
13. `completed_at_utc`
14. `project_id`
15. `project_name`
16. `phase_id`
17. `phase_name`
18. `created_at_utc`
19. `updated_at_utc`

`legacy_actual_minutes` is exported for completeness but does not replace
Activity as Dayflow's canonical time ledger.

## Activity Columns

Activity CSV columns, in order:

1. `activity_id`
2. `started_at_utc`
3. `local_date`
4. `local_start_time`
5. `timezone`
6. `duration_minutes`
7. `category`
8. `note`
9. `origin`
10. `task_id`
11. `task_title`
12. `direct_project_id`
13. `direct_project_name`
14. `attributed_project_id`
15. `attributed_project_name`
16. `focus_session_id`
17. `created_at_utc`
18. `updated_at_utc`

Direct Project fields expose the persisted direct relationship. Attributed
Project fields expose the historical Project attribution used by Project and
Review calculations.

## User Experience

- Data & backups gains a clearly separated **Portable CSV exports** section.
- Copy states that CSV is for spreadsheets and analysis, not recovery.
- Separate buttons download complete Task history and complete Activity
  history.
- While one export is loading, only that export button is disabled.
- A successful response downloads the canonical filename and announces
  completion.
- A failed or malformed response remains in the dialog as an actionable error
  and does not download a file.
- Backup creation, inspection, and restore remain independent from CSV export.

## Acceptance Criteria

1. Task export includes records outside every dashboard or Journal preview.
2. Activity export includes Manual and Focus Activities across all dates.
3. Empty datasets still return the exact header row.
4. Rows follow the specified deterministic order.
5. All columns appear in the specified order.
6. Task dates remain local calendar dates rather than shifting through UTC.
7. Activity UTC and local timestamp fields represent the same instant.
8. Relationship identifiers and current names are included when available.
9. Deleted or absent optional relationships produce empty cells.
10. Unicode, commas, quotes, CR, and LF round-trip as one cell.
11. Formula-like user text is prefixed safely.
12. Response format, version, kind, row count, filename, cache, type, and
    attachment headers are canonical.
13. Unsupported kinds return typed JSON without attachment headers.
14. UI controls download both documents and expose failures without leaving
    Data & backups.
15. Exporting does not mutate record counts or timestamps.

## Required Test Coverage

- Unit tests through the CSV export module interface for both kinds, exact
  headers, ordering, empty exports, date semantics, Unicode, CSV escaping,
  formula safety, relationships, filenames, and metadata.
- Route contract tests for unsupported kinds and canonical successful headers.
- Browser tests for complete persisted history, Manual and Focus Activity
  inclusion, formula safety, UI download controls, canonical filenames, and
  malformed or rejected response handling.
- The complete reliability gate.

## Release Gate

CSV Export v1 is complete when:

- the deep module owns all retrieval and serialization rules;
- both endpoint kinds return complete, canonical documents;
- the UI downloads only validated CSV responses;
- required unit, contract, and browser coverage passes;
- the complete reliability gate passes;
- README and project status describe CSV as supplemental, not restorable.

## Implementation Record

Implemented July 28, 2026.

- `src/lib/csv-export.ts` owns complete retrieval, stable fields and ordering,
  date/time representation, formula safety, and CSV serialization.
- `src/lib/csv-export-contract.ts` owns the shared kind, filename, response
  metadata, and strict browser-validation contract.
- `GET /api/exports/tasks` and `GET /api/exports/activities` expose the
  complete documents through one thin dynamic route.
- **Data & backups** provides separate validated Task and Activity downloads
  while retaining independent backup and restore controls.
- Unit coverage verifies the deep module and shared response contract; browser
  coverage verifies complete history, Manual and Focus Activities, canonical
  endpoint metadata, both successful UI downloads, and malformed-response
  refusal.
- The complete `npm run check` reliability gate passed on July 28, 2026:
  122 unit tests, 13 backup/integration tests, all migration fixtures, the
  production build, and 84 Chromium browser tests.
