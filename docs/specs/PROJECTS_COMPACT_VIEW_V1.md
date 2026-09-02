# Projects Compact View v1

Status: Proposed
Date: September 2, 2026
Scope: An optional dense list presentation for the Projects overview
Issue: #36

## Purpose

The Projects overview renders every project as a spacious card with a
290px minimum height. With more than a handful of projects, scanning and
comparing them requires long vertical scrolling.

Projects Compact View v1 adds a second, denser presentation of the same
overview. It is purely presentational: it changes how project summaries are
laid out, not what a Project is, how it progresses, or what actions exist.

## Goals

- Offer a clear, always-visible switch between the existing Cards view and a
  new Compact view.
- Show meaningfully more projects per viewport in Compact view without
  horizontal scrolling.
- Keep essential information in every Compact row: name, status, progress,
  next step, and the primary actions (open, start Focus).
- Persist the chosen view on the same device across reloads.
- Remain usable at the phone, compact, and desktop layout modes and with
  keyboard navigation.

## Non-Goals

- Changing Project data, lifecycle, or task/phase semantics (out of scope per
  the issue).
- Changing the Project detail workspace.
- Adding sorting, grouping, or search to the overview.
- Syncing the preference across devices.

## View switch

A shared segmented control (`.segmented-control`, the same pattern Backlog
arrangements use) appears in the Projects overview panel, on the same row as
the status filters, right-aligned:

```
[ Active 4 ] [ Paused 1 ] [ Completed 2 ] [ Archived 0 ]      [ Cards | Compact ]
```

- Two options only: **Cards** (current layout, default) and **Compact**.
- Buttons carry `aria-pressed`, matching the existing filter buttons.
- The control is labeled `aria-label="Project view"`.
- Switching views never changes the selected status filter, scroll intent, or
  any data.

## Compact layout

Compact view replaces the card grid with a single vertical list. Each project
is one row inside one shared panel, so density comes from removing per-card
chrome, not from shrinking text below readable sizes.

Desktop / compact layout row (one line, ~52px tall):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● Thesis draft            ▓▓▓▓▓▓░░░░ 60%   9/15 tasks   Next: Revise ch. 3  [▶ 25m] │
│ ● Garden redesign         ▓▓░░░░░░░░ 20%   2/10 tasks   Next: Order soil    [▶ 30m] │
│ ● Language course         ░░░░░░░░░░  —    No tasks yet Next: Add a first task       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Row anatomy, left to right:

1. **Status dot** — a small colored dot reusing the existing status palette
   (`status-active`, `status-paused`, …). The textual status pill is dropped;
   the status filter already establishes context, and the dot carries an
   `aria-label` / tooltip with the full status name. When mixed statuses can
   never appear (the filter guarantees one status per list), the dot is
   decorative reinforcement, not the only signal.
2. **Name** — the row's open control (a button, like `.project-card-open`),
   single line, ellipsized. `desiredOutcome` is not shown in Compact view; it
   remains available in Cards view and the detail page.
3. **Progress** — a thin inline meter (reusing `.meter`, height reduced to
   4px) plus the percent, or an em dash when `progressPercent` is null.
4. **Tasks** — `9/15 tasks` or `No tasks yet`.
5. **Next step** — `Next:` label and the next task title, ellipsized. When no
   task exists: `Add a first task`.
6. **Focus action** — the existing Focus button, reduced to an icon + planned
   minutes (`▶ 25m`), rendered only when `nextTaskId` exists. Same handler
   and payload as Cards view.

Deliberately omitted from Compact rows (still in Cards view and detail):
target date / duration remaining, invested minutes, weekly budget, phase
count, and the outcome description. These are secondary for quick scanning;
Compact view optimizes for "which project, how far along, what's next."

The "Start a finishable outcome" create card becomes a single slim row at the
end of the list (`+ New project`), and the empty state is unchanged.

## Responsive behavior

Compact view keys off the existing `data-layout-mode` attribute; no new
breakpoints are introduced.

- **Desktop / compact modes**: the single-line row above. Columns use a CSS
  grid (`auto 1fr auto auto minmax(0, 1fr) auto`) so nothing forces
  horizontal scrolling; name and next step are the two truncating columns.
- **Phone mode**: the row wraps to two lines and drops the tasks count
  (progress percent already summarizes it):

```
● Thesis draft                        [▶ 25m]
  ▓▓▓▓▓▓░░░░ 60% · Next: Revise ch. 3
```

The view switch remains available in phone mode; density is useful on small
screens too.

## Persistence

- The selection is stored in `localStorage` under `dayflow-projects-view`
  with values `"cards"` and `"compact"`, following the existing
  `dayflow-first-run-seen` precedent.
- Missing, unreadable, or unrecognized values fall back to `"cards"`.
- The value is read once on mount and written on every switch. Storage
  failures (private browsing, quota) degrade silently to a session-only
  preference.
- The preference is per device by design; it never round-trips the server.

## Keyboard and accessibility

- Tab order per row: open button (name), then Focus button. This matches the
  Cards tab order, so switching views does not change interaction structure.
- The segmented control is reachable by Tab and operable with Enter/Space,
  identical to the Backlog arrangement control.
- Row height stays ≥ 44px so touch targets remain adequate.
- The meter keeps its existing `aria-label` (`"60% of current plan"`).
- Switching views moves no focus and announces nothing beyond the pressed
  state; the list itself keeps its `aria-label`
  (`"Active projects"` etc.).

## Implementation sketch

- `ProjectsWorkspace` gains `view: "cards" | "compact"` state, initialized
  from `localStorage` in a `useEffect` (SSR-safe, defaulting to `"cards"`).
- `ProjectCard` stays untouched; a sibling `ProjectRow` component renders the
  compact row from the same `ProjectSummary` and the same `onOpen` /
  `onStartFocus` props. No API or Prisma changes.
- New CSS: `.project-list`, `.project-row`, `.project-row-dot`,
  `.project-row-next`, plus a `.meter.slim` variant — roughly 60 lines,
  reusing existing tokens (`--surface-2`, `--muted`, `--sage-soft`).
- The segmented control reuses the shared `.segmented-control` styles.

## Acceptance criteria mapping

| Issue criterion | Design answer |
| --- | --- |
| Clear way to switch views | Segmented Cards / Compact control in the overview panel |
| More projects per viewport, no horizontal scroll | ~52px rows vs ≥290px cards (≈5× density); truncating grid columns |
| Essential info and primary actions remain | Name, status, progress, tasks, next step, open, Focus |
| Preserved across reloads on the device | `localStorage["dayflow-projects-view"]` |
| Usable at breakpoints and via keyboard | Reuses layout modes; identical tab structure per row |
