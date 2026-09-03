# Projects List View v1

Status: Implemented
Date: September 2, 2026
Scope: An optional dense list presentation for the Projects overview,
with per-Project task disclosure
Issue: #36

## Purpose

The Projects overview renders every project as a spacious card with a
290px minimum height. With more than a handful of projects, scanning and
comparing them requires long vertical scrolling.

Projects List View v1 adds a second, denser presentation of the same
overview. It is purely presentational: it changes how project summaries are
laid out, not what a Project is, how it progresses, or what actions exist.

## Goals

- Offer a clear, always-visible switch between the existing Cards view and a
  new List view.
- Show meaningfully more projects per viewport in List view without
  horizontal scrolling.
- Keep essential information in every List row: name, status, progress,
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
[ Active 4 ] [ Paused 1 ] [ Completed 2 ] [ Archived 0 ]      [ Cards | List ]
```

- Two options only: **Cards** (current layout, default) and **List**.
- The control follows the shared segmented-control radio pattern: its wrapper
  is a `radiogroup` labeled `aria-label="Project view"`, and each option is a
  `radio` with `aria-checked` and roving `tabIndex`.
- Switching views never changes the selected status filter, scroll intent, or
  any data.

## List layout

List view replaces the card grid with a single vertical list. Each project
is one row inside one shared panel, so density comes from removing per-card
chrome, not from shrinking text below readable sizes.

Desktop / compact layout row (one line, ~60px tall including the 44px open
target and row padding):

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
   tooltip with the full status name. Because the status filter guarantees one
   status per list, the dot is decorative (`aria-hidden="true"`) and is not the
   only signal.
2. **Name** — the row's open control (a button, like `.project-card-open`),
   single line, ellipsized. `desiredOutcome` is not shown in List view; it
   remains available in Cards view and the detail page.
3. **Progress** — a thin inline meter (reusing `.meter`, height reduced to
   4px) plus the percent, or an em dash when `progressPercent` is null.
4. **Tasks** — `9/15 tasks` or `No tasks yet`.
5. **Next step** — `Next:` label and the next task title, ellipsized. When no
   task exists: `Add a first task`.
6. **Focus action** — the existing Focus button, reduced to an icon + planned
   minutes (`▶ 25m`), rendered only when `nextTaskId` exists. Same handler
   and payload as Cards view.

Deliberately omitted from List rows (still in Cards view and detail):
target date / duration remaining, invested minutes, weekly budget, phase
count, and the outcome description. These are secondary for quick scanning;
List view optimizes for "which project, how far along, what's next."

The "Start a finishable outcome" create card becomes a single slim row at the
end of the list (`+ New project`), and the empty state is unchanged.

## Responsive behavior

List view keys off the existing `data-layout-mode` attribute; no new
breakpoints are introduced.

- **Desktop / compact modes**: the single-line row above. Columns use a stable
  CSS grid (`auto 1fr auto 100px minmax(0, 1fr) 65px`) so rows with and without
  a Focus action stay aligned. Name, task count, and next step truncate inside
  their tracks, and the full name/task/next-step copy remains available through
  a tooltip.
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
- A lazy state initializer reads the value before the first Projects render,
  avoiding a Cards-to-List flash. The value is written on every switch.
  Storage failures (private browsing, quota) degrade silently to a session-only
  preference.
- The preference is per device by design; it never round-trips the server.

## Keyboard and accessibility

- Tab order per row: open button (name), then Focus button. This matches the
  Cards tab order, so switching views does not change interaction structure.
- The segmented control follows the same radio-group behavior as Backlog:
  Tab reaches the checked option, Enter/Space selects it, and arrow keys wrap
  through the options while moving selection and focus.
- Row height stays ≥ 44px so touch targets remain adequate.
- The meter keeps its existing `aria-label` (`"60% of current plan"`).
- Clicking a view keeps focus on that option; arrow-key switching moves focus
  to the newly checked option. The list itself keeps its `aria-label`
  (`"Active projects"` etc.).

## Implementation sketch

- `ProjectsWorkspace` gains `view: "cards" | "compact"` state, initialized
  by an SSR-safe lazy `localStorage` reader that defaults to `"cards"`.
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
| Clear way to switch views | Segmented Cards / List control in the overview panel |
| More projects per viewport, no horizontal scroll | ~60px rows vs ≥290px cards; rendered phone and large-count overflow checks |
| Essential info and primary actions remain | Name, status, progress, tasks, next step, open, Focus |
| Preserved across reloads on the device | `localStorage["dayflow-projects-view"]`; no intermediate Cards render |
| Usable at breakpoints and via keyboard | Reuses layout modes; radio-group arrow-key and roving-tab-stop behavior |


## Task disclosure (added with the rename)

Each List row carries a leading disclosure control that reveals that
Project's tasks in place.

- The control is a dedicated `button` with `aria-expanded` and
  `aria-controls`, **not** a `<details>` / `<summary>` wrapper. The row
  already holds two controls — the Project name opens the Project, and the
  Focus button starts a session — and any control inside a `summary` toggles
  it when clicked, so the three would fight each other.
- It sits in a new leading column, before the status dot, which is the
  conventional position for a disclosure and reads as hierarchy rather than
  as another row action.
- Expanded rows tint faintly and the chevron rotates a quarter turn. Both
  respect `prefers-reduced-motion`.
- On phone the control spans both summary rows as a 44px-tall touch target.

### Drawer contents

Tasks are grouped by Phase when the Project defines any, otherwise listed
flat. Each task shows its completion mark, title, whether it is Scheduled or
in the Backlog, and its estimate. A trailing "Open <Project>" control leads
to the Project workspace.

The drawer is **read-only**. Editing, scheduling, and Phase management stay
on the Project page; duplicating them here would mean two implementations to
keep in step.

### Loading

Task lists are not part of the Projects overview payload, so the first
expand fetches `GET /api/projects/:id` — the same detail the Project page
uses — and keeps the result for later toggles of that row. The drawer
reports its own loading, empty, and failure states, and a failed load offers
a retry without collapsing the row.

### Naming

The view was called "Compact" through its first release. "Compact" describes
density while its counterpart "Cards" describes form, and once rows expand
the label is no longer even accurate. "List" pairs with "Cards" and survives
the disclosure. The stored preference value `compact` is still read so an
existing choice is not lost.
