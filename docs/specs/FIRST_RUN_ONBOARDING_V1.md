# First-Run Onboarding v1

Status: Implemented
Date: July 29, 2026

> **Evidence contract:** [Evidence Integrity v1](./EVIDENCE_INTEGRITY_V1.md)
> remains authoritative for persisted Notes, Diary, References, Activities,
> and Reviews.
>
> **Reliability contract:**
> [Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md) remains
> authoritative for typed bootstrap responses and honest mutation failures.

## Purpose

Dayflow should welcome a genuinely empty local workspace without mistaking an
established workspace for a new one. First-Run Onboarding v1 turns the existing
empty-state controls into dependable handoffs, explains the core workflow, and
keeps the first useful action small.

## Workspace Readiness

The bootstrap route is the authoritative interface for whether the active
workspace is empty:

```ts
{
  workspaceEmpty: boolean;
}
```

`workspaceEmpty` is `true` only when every meaningful persisted workspace
record category is empty:

- Projects
- Tasks
- Notes
- Diary Entries
- Reviews
- References
- Time Blocks
- Activities
- Focus Sessions, including canceled Focus and Break Sessions

The check is global. It is not limited by today, the current Review Period,
task status, or bootstrap preview limits.

Project Phases and Task Schedule Changes do not need separate readiness checks:
their required parent Project or Task already establishes the workspace.
Mutation Receipts, migrations, and backup files are internal reliability
records and never establish the workspace.

The browser displays onboarding only when:

1. the bootstrap reports `workspaceEmpty: true`; and
2. this browser has not already completed first-task onboarding.

An established workspace never shows “Nothing here yet” merely because its
current day is empty.

## Core Workflow Explanation

The first-run page briefly names Dayflow's operating loop:

1. **Decide** what matters.
2. **Plan** when to give it attention.
3. **Record** what happened.
4. **Capture** useful context.
5. **Review** the evidence and choose what is next.

The explanation stays subordinate to the first action and does not introduce a
setup wizard.

## First Task

- The user can name one task and either move into the 25-minute Focus flow or
  add the task to Today.
- Both actions remain disabled for a blank title or while the save is pending.
- A failed or malformed save keeps the exact draft visible and offers the same
  action for retry.
- Only a confirmed, structurally valid Task response completes first-task
  onboarding in local browser state.
- The Focus flow receives the confirmed Task and a 25-minute duration only
  after the Task is saved. Compact layouts may start that Focus Session
  directly; wider layouts prepare the existing Focus rail for confirmation.

## Project Handoff

- “Group work under a project” navigates to Projects and opens the existing
  Create Project dialog.
- The Project name receives focus.
- Canceling does not clear the first-task draft or complete onboarding.
- Closing the dialog returns focus to Projects' stable “New project” control.
- A confirmed Project makes the workspace established through the bootstrap
  readiness contract.

## Capture Handoff

- “Capture anything” opens the existing Search or Add command palette.
- The palette query receives focus.
- Escape closes the palette and restores focus to the onboarding Capture
  control.
- Canceling does not clear the first-task draft or complete onboarding.
- A confirmed capture makes the workspace established through the bootstrap
  readiness contract.

## Phone and Keyboard Behavior

- The first-run page does not create horizontal page overflow at phone width.
- Primary and secondary actions have at least 44-pixel touch targets on phone.
- The workflow explanation remains readable without a desktop-only shortcut.
- Native button keyboard activation works for both handoffs.
- Dialog focus behavior follows the contracts above.

## Non-Goals

- A multi-step setup wizard, account setup, import, sync, or preferences.
- Sample or demo data.
- Progress persistence for partially completed onboarding.
- Automatically creating Projects, Notes, References, Activities, or Reviews.
- A new capture surface separate from the command palette.
- A new Project creation surface separate from Projects.
- Changing the semantics of Evidence, Focus, Projects, or Review.

## Acceptance Criteria

1. Every meaningful persisted record category suppresses first-run onboarding,
   even when that record is outside today's bootstrap windows.
2. Internal Mutation Receipts alone do not suppress onboarding.
3. Empty workspaces still show the first-run page when the browser has not
   completed it.
4. The first-task failure path preserves the exact draft and retries cleanly.
5. The Project handoff opens Create Project and focuses its name field.
6. The Capture handoff opens Search or Add, focuses its query, and restores
   focus on Escape.
7. Canceling either handoff preserves the first-task draft.
8. Secondary handoffs cannot race a pending first-task save.
9. The Decide → Plan → Record → Capture → Review loop is visible.
10. The first-run page remains usable without horizontal overflow on phone.

## Required Coverage

- Disposable-SQLite bootstrap coverage for empty, meaningful-record, and
  internal-record-only workspaces.
- Browser coverage for first-task failure recovery, Project and Capture
  handoffs, focus transfer/restoration, draft preservation, and phone layout.
- Existing browser helpers may continue bypassing first-run onboarding; the
  onboarding suite must exercise it without the bypass flag.
- The complete reliability, migration, backup, production-build, and Chromium
  gates remain mandatory.

## Implementation Record

Implemented July 29, 2026.

- Bootstrap now exposes one authoritative `workspaceEmpty` value derived from
  complete persisted workspace history rather than windowed page data.
- First-run Project and Capture controls hand off to the existing Create
  Project dialog and Search or Add palette with forward and return focus.
- The first-task draft survives canceled handoffs and lost-success retries;
  secondary handoffs stay disabled while its save is pending.
- The Decide → Plan → Record → Capture → Review loop is visible and collapses
  to a readable phone layout with 44-pixel action targets.
- Disposable-SQLite coverage verifies every meaningful readiness category and
  excludes Mutation Receipts. Browser coverage verifies historical readiness,
  keyboard handoffs, focus restoration, retry convergence, draft preservation,
  pending-state exclusion, and phone overflow.
- The complete `npm run check` reliability gate passed on July 29, 2026:
  137 unit tests, 14 backup/integration tests, all migration fixtures, the
  production build, and 100 Chromium browser tests.
