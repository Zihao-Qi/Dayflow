# Dayflow Project Status and Plan

Last updated: July 29, 2026

## Project Goal

Dayflow is a local-first personal productivity dashboard that combines a refined notebook, daily task manager, diary, materials library, and progress dashboard. The first version is designed to run locally without accounts or hosting, while keeping the architecture practical for a later hosted version.

## Current Status

The app is a working local MVP built with:

- Next.js App Router
- TypeScript
- SQLite
- Prisma Client
- Recharts
- lucide-react icons

Recent front-end polish and responsive layout work has been documented in:

- `DAYFLOW_CHANGELOG.md`

The approved specification for finishable Projects, optional Phases, Project
backlogs, progress tracking, and confirmation-based unfinished-task handling is:

- `docs/specs/PROJECTS_V1.md`

The July 27 independent review produced two corrective specifications:

- `docs/specs/EVIDENCE_INTEGRITY_V1.md` — implemented July 27
- `docs/specs/LOCAL_DATA_RELIABILITY_V1.md` — implemented July 27

The migration recovery contract is:

- `docs/specs/MIGRATION_SAFETY_BACKUPS_V1.md` — implemented July 29

The global capture contract is:

- `docs/specs/COMMAND_PALETTE_V1.md` — implemented July 28

The manual planning contract is:

- `docs/specs/TIME_BLOCKS_V1.md` — implemented July 28

The manual Activity correction contract is:

- `docs/specs/ACTIVITY_EDITING_V1.md` — implemented July 28

The retrospective Activity capture and category-label contract is:

- `docs/specs/ACTIVITY_CAPTURE_V1.md` — implemented July 28

The portable analysis-export contract is:

- `docs/specs/CSV_EXPORT_V1.md` — implemented July 28

The Journal relationship-capture contract is:

- `docs/specs/JOURNAL_RELATIONSHIPS_V1.md` — implemented July 29

The Journal retrieval contract is:

- `docs/specs/JOURNAL_SEARCH_FILTERING_V1.md` — implemented July 29

The first-run workspace-readiness and handoff contract is:

- `docs/specs/FIRST_RUN_ONBOARDING_V1.md` — implemented July 29

The Review history contract is:

- `docs/specs/REVIEW_PERIOD_BROWSING_V1.md` — implemented August 22, 2026

The canonical workspace navigation decision is:

- `docs/adr/0001-six-destination-workspace.md`

The shipped interface now uses six clear destinations: Today, Log, Projects,
Backlog, Journal, and Review. Frequent actions remain immediately available,
Project detail stays on one page, and Backlog arrangements remain behind the
Arrange control.

The current collaboration plan is for Gemini to take more of the front-end iteration work, especially layout refinement, visual polish, responsiveness, and interaction design. This status file should remain the higher-level project record and planning document.

The local app runs at:

```bash
http://localhost:3000
```

## Product Direction and Competitive Notes

The public product pages for [Funemployment Day](https://funemploymentday.app/) were reviewed in July 2026 as a useful comparison for time tracking, daily structure, and progress reporting.

The main lesson is not to copy its unemployment-specific positioning or hosted subscription model. Dayflow should remain a broader, local-first personal workspace. The useful ideas are:

- Treat time as a first-class record, not only an estimate attached to a task.
- Let users record actual activities with a duration, category, optional task, and short accomplishment note.
- Use categories such as deep work, learning, administration, health, rest, or custom areas to show where time is going.
- Turn completed tasks, activity records, notes, materials, mood, and energy into a weekly evidence-of-progress review.
- Provide human-friendly CSV export in addition to the existing agent-oriented JSON export.
- Use supportive prompts that help make small accomplishments visible without becoming judgmental or overly gamified.
- Consider an installable Progressive Web App so the local tool feels more like a dedicated desktop or mobile application.

Funemployment Day has a narrower and immediately understandable promise around restoring routine, structure, momentum, and progress. Dayflow already has a richer working dashboard and should preserve its calmer notebook identity and the headline “Make today legible.” Future product copy and onboarding should make the daily loop equally clear:

1. Decide what matters.
2. Plan the day.
3. Record what actually happened.
4. Capture useful thoughts and materials.
5. Review visible evidence of progress.

## Implemented Features

### Focus Timer

- Adds a persistent Focus Timer to Today without introducing another primary destination.
- Keeps active timer management mounted across Today, Log, Projects, Backlog,
  Journal, and Review, with a compact strip outside Today.
- Lets Today and Project task actions prefill the Timer directly.
- Supports 25-minute and 50-minute focus presets plus any custom duration from 1 to 240 minutes.
- Allows a session to link to a Task, a Project, or neither; Project context is inherited from a linked Task.
- Keeps one running or paused session across page reloads.
- Supports pause, resume, finish early, and cancel.
- Atomically converts completed Focus Sessions with at least one elapsed minute
  into exactly one Activity, with optional details enriching that evidence.
- Enforces one running or paused session at the database boundary, including
  concurrent tabs.
- Keeps Break Sessions separate from Activity time and suggests an appropriate break after focus.
- Derives focused minutes from Focus-origin Activities while retaining Focus
  Sessions as timer lifecycle records.
- Can show a browser completion notification after the user explicitly enables permission.
- Keeps timer logic behind a reusable domain interface for a future macOS companion.

### Usability Stabilization

- Renames unfinished-task actions so removing a date and keeping the original
  date are explicit.
- Saves Today task-title edits once on blur or Enter rather than once per
  keystroke, with visible save feedback.
- Separates optional Project target duration in days or weeks from the weekly
  effort budget.
- Confirms cancellation when a Focus Session has accumulated meaningful work.
- Makes Activity span the tablet grid instead of leaving an empty panel cell.

### First-Run Onboarding

- Shows onboarding only for a genuinely empty workspace, using complete
  persisted Projects, Tasks, Notes, Diary Entries, Reviews, References, Time
  Blocks, Activities, and Focus Sessions rather than today's preview.
- Keeps internal Mutation Receipts from falsely establishing a workspace.
- Explains the Decide → Plan → Record → Capture → Review loop without adding a
  setup wizard.
- Preserves the first-Task draft through canceled handoffs and idempotent
  lost-success recovery.
- Opens the existing Create Project and Search or Add surfaces with deliberate
  forward and return focus.
- Keeps secondary handoffs out of a pending first-Task save and gives all four
  phone actions 44-pixel touch targets without horizontal overflow.

### Local Data Reliability

- Preserves Task, Activity, Note, Material, Project, and Phase drafts until the
  server returns a validated canonical record.
- Makes retried Task, Activity, Note, Material, Project, Phase, and Focus
  Session creates idempotent with stable client mutation IDs and transactional
  durable receipts; Diary uses its unique date as a natural key.
- Centralizes bounded API validation and returns typed validation, not-found,
  conflict, and internal errors without exposing database details.
- Keeps Notes and References completely reachable with stable cursor
  pagination and snapshot-consistent totals.
- Provides a complete, versioned JSON export without dashboard preview caps.
- Provides complete, formula-safe Task and Activity CSV downloads with stable
  columns, deterministic ordering, portable local calendar fields, and exact
  Activity timestamps.
- Uses checked-in migrations for supported upgrades and tests every prior
  schema fixture.
- Creates and verifies a retained safety artifact before mutating any
  recognized existing database during migration, rejects unsupported shapes
  before mutation, and reports an explicit restore command after any
  post-backup failure. Fresh databases and validated disposable restore copies
  avoid redundant artifacts.
- Adds atomic, checksummed `db:backup` and conservative `db:restore` commands.
  Restore verifies data, relationships, the exact schema, and migration
  checksums, recreates a missing working database, and retains a safety backup
  before replacing an existing one.
- Adds a local **Data & backups** dialog for creating, downloading, inspecting,
  and selecting managed backups. UI restores are checksum-bound and staged for
  the next process startup, before the first Prisma request opens the database.
  Pre-replacement failures preserve the active database; interrupted
  post-replacement outcomes direct the user to verify data and retain any
  safety copy that was actually created.
- Runs browser, migration, and destructive backup tests against disposable
  databases outside the user’s active data path.

### Projects and Multi-Layer Planning

- Gives finishable Projects their own primary destination.
- Keeps each Project detail on one page: outcome and metrics, next step, plan,
  phases, tasks, Backlog access, and collapsible evidence remain in one
  continuous workspace.
- Supports optional Phases while allowing tasks to live directly at the Project root.
- Lets Project and standalone tasks remain unscheduled in a backlog.
- Uses completed-task count for current-plan progress and recorded Activity time for invested effort.
- Separates all-time Invested Time from Review-Period Invested Time and compares
  weekly budgets only with the latter.
- Requires explicit Project completion and derives Phase completion from current tasks.
- Supports Active, Paused, Completed, and Archived Project states.
- Preserves associated tasks, activities, notes, and materials when a Project container is deleted.
- Lets activities, notes, and materials link directly to Projects.
- Rejects direct Project attribution that conflicts with a linked Task.
- Shows Project context quietly on Today tasks and Project progress in Review.
- Surfaces unfinished scheduled tasks without silently changing their dates.
- Supports moving unfinished tasks to today, choosing another day, returning them to a backlog, leaving them in place, and undoing a schedule move.
- Keeps ongoing Areas and AI-generated or automatically arranged plans deferred to later specifications.

### Today View

- Shows today’s tasks.
- Supports adding tasks.
- Supports editing task titles inline.
- Supports completing and reopening tasks.
- Supports deleting tasks.
- Supports drag-and-drop task reordering using the task row grip handle.
- Keeps task status, deadline, estimated minutes, urgency, importance, and deletion in expandable task details.
- Collapses completed work into a quieter completed group.
- Shows daily progress and planned vs recorded activity time.
- Keeps activity capture and recent activity alongside the focused task list.

### Activity and Time Logging

- Supports manually recording what happened today or on any earlier local
  calendar date while rejecting future evidence.
- Stores activity time, duration, category, accomplishment note, and an optional linked task.
- Keeps the calm default category labels and offers labels from complete
  Activity history as deterministic suggestions while allowing any bounded
  custom label.
- Supports correcting Manual Activities from Log without changing their
  identity or original local calendar day.
- Revalidates deliberately changed Task and Project relationships while
  preserving historical Project attribution when those relationships stay
  unchanged.
- Keeps Focus-generated Activity evidence protected behind the Focus workflow.
- Preserves the complete Activity edit draft through rejected, malformed, or
  mismatched responses.
- Uses activity durations as the source for Daily Pulse spent time and weekly actual-time charts.
- Supports deleting activity entries.
- Includes activities in the local agent export.
- Reconciles legacy task-level actual minutes into Activity entries during migration.

### Manual Time Blocks

- Keeps planned Time Blocks distinct from recorded Activity and Focus evidence.
- Supports freeform and Task-prefilled creation from the Log Timeline.
- Preserves a Task-linked title snapshot without changing the Task itself.
- Supports full editing and deliberately confirmed deletion.
- Rejects overlapping planned intervals while allowing adjacent blocks and
  planned-versus-recorded overlap.
- Uses idempotent creation, typed errors, canonical response validation, and
  draft preservation across failed saves.
- Keeps the single planned lane and editor usable with keyboard, pointer,
  touch, and phone layouts.

### Urgency and Importance Matrix

- Shows tasks on an X-Y matrix:
  - X axis: urgency
  - Y axis: importance
- Tasks can be placed by selecting urgency and importance values.
- Tasks can be dragged directly on the matrix to update their urgency and importance.
- Urgency automatically increases when a task deadline gets close.
- Urgency selector uses five colored dots:
  - Left side is gray for not urgent.
  - Right side is red for very urgent.
- Importance selector uses five colored dots:
  - Lower importance starts gray.
  - Higher importance moves toward blue.
- Matrix quadrants are color-matched:
  - Important and urgent: purple, combining the red and blue axes
  - Important and not urgent: blue
  - Urgent and less important: red
  - Neither urgent nor important: gray

### Backlog

- Keeps unscheduled work in one Backlog destination.
- Places its arrangements behind Arrange: Quadrant, Project, and Due.
- Adds Figure on larger screens as the read-oriented presentation of the same
  urgency/importance matrix; Quadrant remains the action-oriented table view.
- Keeps Today scheduling, day picking, focus, and Project scoping attached to
  the same persistent task records.

### Notes and Diary

- Groups diary, notes, and references under one Journal destination.
- Supports quick notes.
- Supports tags on notes.
- Searches complete Note history by content and filters by one exact canonical
  tag without changing newest-first pagination.
- Lets Notes link to available Tasks while inheriting compatible Project
  context.
- Supports daily diary content.
- Supports mood and energy sliders.
- Supports reflection content in the review flow.

### Materials Library

- Lives in the Journal as the canonical place to browse and save references.
- Supports saving materials such as YouTube links, articles, websites, PDFs, or references.
- Stores title, URL, type, notes, and optional task attachment fields.
- Lets References link to available Tasks and paginated Note history while
  preserving Note provenance separately from Project attribution.
- Displays saved materials in a library-style list.
- Searches complete Reference history across title, URL, and notes.

### Review Evidence Presentation

- Lives in Review rather than competing with today's work.
- Shows recorded time, Focus-origin time, completed tasks, and saved Diary
  days for the Review Period.
- Shows Activity distribution by category with each category's share of
  recorded time.
- Shows average mood and energy across saved Diary days only, and says
  explicitly that missing days stay missing.
- Uses plain typographic readouts rather than a charting library. The earlier
  Recharts bar charts for completion rate, tasks completed, planned versus
  actual time, and mood and energy trends were removed when the weekly
  evidence Review shipped and have not been reintroduced.

### Front-End Polish and Responsiveness

- Uses Today, Log, Projects, Backlog, Journal, and Review as the primary IA.
- Removes duplicated notes, materials, diary, matrix, and chart surfaces from Today.
- Adds a global Capture menu that searches unfinished Tasks and active Projects,
  understands Focus, Note, and URL intents, and preserves typed text when
  handing a draft to its canonical form.
- Supports arrow-key selection, Enter activation, Escape focus restoration,
  honest invalid-command states, and the same capture flow on phone layouts.
- Keeps secondary data and display controls outside the six primary
  destinations for progressive disclosure.
- Uses five mobile tabs—Today, Log, Projects, Review, and More—with Backlog and
  Journal available under More.
- Task control layout now uses wrapping flex behavior to avoid overlap between deadline, status, estimate, urgency, and importance controls.
- Task title inputs truncate long text cleanly instead of colliding with row actions.
- Daily pulse metrics use a more resilient responsive grid.
- The right-side daily pulse panel has a minimum width and drops below the task list on narrower screens.
- Panels now use a flatter border-led visual style, with drag feedback reserved for active task movement.
- Buttons and rating dots have clearer hover and active states.
- Notes and Materials tabs include empty states.
- Mobile navigation switches to a fixed bottom tab bar on small screens.
- Compact mode reduces spacing and control sizes for higher task density.

### Review View

- Summarizes the seven local calendar days ending today as a derived Review
  Summary that never overwrites the Evidence it reads.
- Shows recorded and Focus-origin minutes, completed tasks, saved Diary days,
  captured Notes and References, and Projects moved forward.
- Separates Review-Period Invested Time from all-time Invested Time for each
  Project and compares the weekly budget only with the former.
- Provides a period-bound narrative and next-period intention saved separately
  from the Journal.
- Accepts a saved Review only for the current Review Period.
- Lists Reviews saved for earlier periods, newest first, through stable cursor
  pagination, and opens each on its own stored seven-day window.
- Derives a Past Review Period's summary from current Evidence rather than a
  snapshot, so later corrections are reflected while the saved narrative and
  intention stay fixed in time.
- Keeps Past Review Periods read-only and restores the editable current-period
  save flow on return.

### Agent Export

- Includes a local export API route for external agent consumption:

```bash
/api/agent-export
```

The versioned endpoint exports complete Tasks, schedule changes, Projects,
Phases, Focus Sessions, Notes, Diary entries, Materials, Time Blocks, and
Activities for analysis or a future integration such as Hermes. It is exposed
as a local API rather than primary navigation. It is supplemental; the
checksummed database artifact is the lossless restore format.

### CSV Export

- Downloads complete Task history from `/api/exports/tasks`.
- Downloads complete Manual and Focus Activity history from
  `/api/exports/activities`.
- Uses stable v1 columns, deterministic row ordering, UTF-8 with CRLF records,
  canonical UTC timestamps, explicit local Activity date/time/timezone fields,
  relationship identifiers and names, and formula-safe text cells.
- Exposes separate Task and Activity controls in **Data & backups**, validates
  response metadata and filenames before download, and surfaces malformed or
  rejected responses without creating a file.
- Remains supplemental for spreadsheet analysis; checksummed database backup
  remains the lossless recovery format.

## Data and Local Setup

The project uses a local SQLite database:

```bash
prisma/dev.db
```

Schema and seed files:

- `prisma/schema.prisma`
- `prisma/migrations/`
- `prisma/legacy-upgrades/`
- `prisma/init.sql` (legacy-schema compatibility fixture)
- `prisma/seed.ts`

Useful commands:

```bash
npm run db:setup
npm run db:backup
npm run db:restore -- --from /path/to/dayflow.dayflow-backup --confirm-replace
npm run dev
npm run test:unit
npm run test:backup
npm run test:migrations
npm run typecheck
npm run build
```

`npm run db:setup` applies the checked-in Prisma migrations, runs repeatable
evidence reconciliation, and seeds a new, empty local database. Existing
databases are classified and safely baselined before newer migrations are
applied; the seed step detects existing data and skips itself. The explicitly
destructive demo reset is `npm run db:reset-demo`.

## Verification Completed

The following checks have passed:

```bash
npm run test:e2e
npm run test:unit
npm run test:backup
npm run test:migrations
npm run typecheck
npm run build
```

The Playwright browser suite runs against a disposable SQLite database in the
operating system's temporary directory. It covers focus-session persistence and
Activity recording, activity deletion, task completion, section navigation,
compact mode, task reordering, matrix placement, Project workflows, and narrow
mobile navigation. Reliability scenarios also cover failed and malformed
creates, idempotent replay, more than 100 Notes and References, and complete
JSON export. Managed-backup browser coverage verifies creation, download,
confirmation gating, pending-restore cancellation, and visible scheduling
failure without enabling live restore. The destructive integration suite
covers backup/restore round trips, checksum changes after staging, interrupted
restore markers, a real staged Next startup before first bootstrap, and corrupt
artifacts in its own temporary directory.

Activity Editing coverage verifies in-place Manual Activity correction,
original-day and creation-identity preservation, historical and deliberately
changed Project attribution, protected Focus evidence, optimistic conflicts,
derived Log and Review totals, retry convergence, and complete draft retention
through rejected or ambiguous responses.

Activity Capture coverage verifies past-or-today local dates, server-side
future rejection, free custom labels, complete and deterministic historical
suggestions, Task-derived Project attribution, canonical response checking,
full draft retention through malformed success, and phone usability.

Journal Relationships coverage verifies Task and direct Project attribution,
Task/Note-linked References, inherited Project display, strict canonical
response decoding, typed missing and conflicting relationships without failed
writes, complete draft retention and recovery, paginated access to every Note
option, saved relationship labels, and phone usability. Journal Search &
Filtering coverage verifies complete Note and Reference search, exact tags,
literal wildcard behavior, query-bound cursors, stale-response rejection,
exact retry replay, independent relationship options, preserved capture drafts
and loaded history, and phone usability.

First-Run Onboarding coverage verifies complete-history workspace readiness,
internal-record exclusion, Project and Capture keyboard handoffs, forward and
return focus, preserved drafts, idempotent lost-success recovery, pending-save
exclusion, and phone usability. The complete July 29, 2026 reliability gate
passed with 137 unit tests, 14 backup/integration tests, all migration fixtures,
the production build, and 100 Chromium browser tests.

PWA Installability coverage verifies the typed public manifest, exact PNG media
types and dimensions, rendered head metadata, and Chromium manifest discovery.
The installed identity uses deterministic geometric artwork and deliberately
adds no service worker or offline claim. The complete July 29, 2026 reliability
gate passed with 137 unit tests, 14 backup/integration tests, all migration
fixtures, the production build, and 103 Chromium browser tests.

CSV Export coverage verifies complete historical Task and Activity retrieval,
stable columns and ordering, Manual and Focus Activity inclusion, exact and
local time semantics, relationships, Unicode and CSV escaping, spreadsheet
formula safety, canonical response metadata and filenames, real browser
downloads, and refusal of malformed responses.

The app has also been opened and visually checked in Chrome at:

```bash
http://localhost:3000
```

Verified user-facing behavior includes:

- Dashboard loads successfully.
- Tasks are visible.
- Task completion works.
- Urgency and importance dot controls render without high/low text labels.
- Figure and Quadrant arrangements are available from Backlog’s Arrange control.
- Matrix quadrant colors match the urgency and importance color meanings.
- Task rows can be reordered by dragging the grip handle.
- Advanced task fields expand only when requested.
- Journal provides canonical Diary, Notes, and Materials views.
- Focus Sessions can be started, paused, restored after reload, and canceled from Today.
- The mobile shell uses five bottom navigation items without horizontal overflow.

Additional front-end debugging recorded in `DAYFLOW_CHANGELOG.md`:

- Fixed a client-side `useState` reference error in `TaskRow`.
- Recovered from a local Next.js `.next` cache issue by restarting the development server.

## Known Limitations

- Automated browser coverage currently targets Chromium; Firefox and WebKit are not covered yet.
- Touch-specific drag behavior still needs manual verification on a physical mobile device.
- Focus Timer sessions are single-device and depend on the local Dayflow process; there is no menu-bar or system-wide macOS timer yet.
- Focus and break lengths are chosen per session; configurable default presets and long-break cycles are not implemented yet.
- Complete JSON export and lossless database backup/restore are available from
  local commands and a managed local UI. UI restore is intentionally applied
  on the next Dayflow startup rather than against a live Prisma connection.
  Task and Activity CSV exports are also available for analysis. Printable
  summaries, structured JSON import, arbitrary-path browser import, and
  automatic rolling backups are not implemented.
- Dayflow is installable where supported, but installation remains bound to
  the exact local origin and does not start the local server, copy SQLite, or
  provide offline behavior.
- PDF upload/storage is not implemented yet; materials currently store reference URLs and notes.
- There is no hosted sync, authentication, or multi-device support yet.
- There is no live Hermes integration yet; the local export endpoint is the
  integration boundary.
- `src/app/globals.css` still defines rules for surfaces that no longer render,
  including `.task-panel`, `.matrix-panel`, `.notes-panel`, `.materials-panel`,
  `.range-row`, `.pulse-grid`, and `.review-stack`. The chart rules were removed
  on August 22, 2026; the rest have not been audited.

## Near-Term Plan

### 1. Stabilize Front-End Interaction Quality

- Keep browser coverage for drag reordering, matrix placement, compact mode, activity logging, and mobile navigation passing as the interface evolves.
- Confirm touch behavior for drag interactions on mobile.
- Review keyboard accessibility for task reordering and dot rating controls.
- Keep Gemini-led front-end changes documented in `DAYFLOW_CHANGELOG.md`.

### 2. Improve Planning

- Add a simple day picker for planning future days.
- Validate manual Time Blocks through daily use before adding drag-resizing or
  automatic placement.
- Explore capacity-aware scheduling suggestions only after the manual Projects workflow has been validated.

### 3. Extend Activity and Time Logging

- Validate Manual Activity editing through daily use.
- Validate Focus Timer defaults and break suggestions through daily use.
- Explore a small macOS companion only after the web timer workflow is stable.
- Keep rest and non-task activity valid records rather than treating all progress as task completion.

### 4. Strengthen Notes, Diary, and Materials

- Consider markdown support for diary and notes.
- Add richer diary states for empty days and completed reviews.
- Add gentle prompts such as “What would make today feel complete?”, “Record a small win,” and “What should carry forward?”

### 5. Improve Reviews and Charts

- Validate the seven-day evidence summary and period-bound narrative through
  repeated weekly use.
- Add browsing for seven-day windows that were never written about, addressed
  by an arbitrary anchor day. Browsing saved Reviews shipped on August 22,
  2026; an unreviewed window is the deliberate follow-up, and the read path
  already takes a resolved interval, so it is an added entry point rather than
  a redesign.
- Reintroduce a charting dependency before any of the visualization items
  below. Review currently renders typographic readouts only, and Recharts was
  dropped once the last chart was removed.
- Add mood and energy correlation with completion trends.
- Explore comparison between consecutive Review Periods without turning Review
  into a scorecard.

### 6. Add Local-First Durability and Portability

- Add opt-in rolling automatic backups around the validated manual UI.
- Consider structured JSON import only after conflict and replacement semantics
  are specified; keep database backup as the lossless recovery path.
- Add a printable or shareable weekly summary.

### 7. Improve the App-Like Experience

- Validate installed launch behavior in supported desktop and mobile browsers.
- Define useful offline behavior and make local data status visible.
- Keep Dayflow’s quiet notebook visual identity instead of adopting a generic SaaS dashboard style.

### 8. Prepare for Future Hosted Version

- Keep API routes clean and typed.
- Separate local persistence assumptions from app logic.
- Add authentication only when hosting becomes a real requirement.
- Keep the agent export format stable and documented.

## Suggested Next Technical Steps

1. Keep the reliability, migration, and backup gates mandatory as feature work
   resumes.
2. Validate Manual Time Blocks, Activity editing, and the weekly Review through
   daily use before widening those workflows.
3. Validate installed launch behavior and specify useful offline semantics as
   a separate reliability contract.
4. Keep the handoff convention:
   - Gemini records front-end design and UI changes in `DAYFLOW_CHANGELOG.md`.
   - This file records product status, implementation status, limitations, and development plan.
