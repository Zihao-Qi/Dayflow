# Weekly Evidence Review v1

Status: Implemented
Date: July 28, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for period boundaries, Activity totals, Project
> movement, attribution, and missing evidence.

## Purpose

Review should complete Dayflow's daily loop by turning seven days of persisted
Evidence into a calm, honest account of what moved forward and one explicit
intention for the next period.

The Review Summary is derived from current Evidence. A saved Review contains
only the user's interpretation and next-period intention; it does not copy
metrics or become a competing evidence ledger.

## v1 Scope

- Use the seven-local-day Review Period ending today.
- Summarize:
  - total and focused Activity time;
  - Activity time by category;
  - completed Tasks;
  - Notes captured;
  - Materials saved;
  - days with intentionally saved Diary evidence;
  - average mood and energy across those saved Diary days;
  - Projects that moved forward.
- Preserve missing Diary evidence as missing.
- Save one Review for an exact Review Period.
- Let the user edit:
  - a short narrative about what moved forward;
  - one next-period intention about what deserves protection.
- Keep Review content separate from the current day's Diary reflection.
- Allow repeated saves for the same period to update the same Review.

## Review Summary

All summary values are derived at read time:

```text
recorded minutes =
  sum(Activity.durationMinutes in Review Period)

focused minutes =
  sum(Activity.durationMinutes where origin is Focus in Review Period)

category minutes =
  recorded minutes grouped by Activity.category

completed Tasks =
  Tasks whose completedAt is in Review Period

captured Notes =
  Notes whose evidence date is in Review Period

saved Materials =
  Materials whose createdAt is in Review Period

recorded Diary days =
  intentionally saved Diary entries in Review Period

average mood / energy =
  arithmetic mean across recorded Diary days, otherwise missing
```

Notes and Materials support the narrative but do not independently mark a
Project as moved forward. Project movement follows Evidence Integrity v1.

## Saved Review

A Review belongs to one exact `[periodStart, periodEnd)` pair. Saving again for
that pair updates the existing Review rather than creating another.

The narrative and next-period intention are deliberate Review content. Neither
field is Diary content, and saving a Review must not create or mutate a
Diary entry.

At least one Review field must contain text. Whitespace-only content is treated
as empty. Both fields are bounded and returned in canonical trimmed form.

## Period Changes

The active Review Period moves forward with the local day. A Review saved for
an earlier period remains persisted but is not silently reused as the draft for
the new period.

Editing underlying Tasks or Evidence updates the live Review Summary. It does
not rewrite the saved narrative or intention.

## Non-Goals

- Snapshotting or freezing calculated metrics.
- Review history or comparison browsing.
- Calendar-week configuration.
- Inferring causal relationships between mood, energy, and output.
- AI-written summaries or judgments.
- Printable or shareable reports.

## Acceptance Criteria

1. Review shows recorded and focused Activity time for the exact Review Period.
2. Activity categories sum to the recorded total without double counting.
3. Review shows completed Task, Note, Material, and recorded Diary-day counts.
4. Mood and energy averages use only saved Diary evidence.
5. Missing Diary days remain absent and are not filled with neutral values.
6. Saving a Review persists its narrative and next-period intention without
   creating or changing a Diary entry.
7. Repeated saves for the same Review Period update one Review.
8. A shifted Review Period starts with an empty Review draft.
9. Malformed, empty, or overlong Review mutations return typed 4xx responses.
10. The current Review reloads with its canonical persisted content.
11. The Review layout remains usable at phone, tablet, and desktop widths.

## Required Test Coverage

- Unit tests for Review input validation and summary aggregation.
- Storage/API tests for one Review per period and Diary independence.
- Browser coverage for evidence counts, category distribution, save, and
  reload.
- Existing Review Period and missing-evidence boundary tests remain green.
