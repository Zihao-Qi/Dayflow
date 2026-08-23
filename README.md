# Dayflow

Dayflow is a local-first personal productivity dashboard for planning tasks,
capturing notes and diary entries, saving reference materials, and reviewing
daily progress.

It is built with Next.js, TypeScript, SQLite, Prisma, Recharts, and
lucide-react. The app runs locally without accounts or hosted services.

## Features

- Focused Today view with task creation, completion, inline editing, drag reordering, daily pulse, and activity capture.
- Persistent Focus Timer with 25/5, 50/10, and custom sessions; pause, resume,
  early finish, cancellation, break suggestions, atomic Activity evidence, and
  optional completion details.
- Finishable Projects with optional phases, target duration in days or weeks,
  weekly effort budgets, scheduled and backlog tasks, task-count progress,
  invested-time tracking, and safe lifecycle controls.
- Six stable workspace destinations: Today, Log, Projects, Backlog, Journal, and
  Review, with responsive navigation that condenses access without changing
  content ownership.
- Confirmation-based unfinished-task handling with rescheduling, backlog return, leave-in-place, and undo.
- Expandable task details keep status, deadline, estimate, urgency, and importance available without crowding each row.
- Log views for scheduled work and recorded daily activity, plus Backlog
  arrangements for Quadrant, Project, Due, and sufficiently wide Figure views.
- Manual Activity capture for today or any earlier local date, with free custom
  category labels and complete-history suggestions.
- Manual Activity editing from Log with stable identity and calendar date,
  historical Project attribution, protected Focus evidence, and draft-safe
  retries.
- Manual Time Blocks with freeform or Task-prefilled creation, non-overlapping
  planning, full editing, confirmed deletion, and planned-versus-recorded
  Timeline comparison.
- Journal workspace for diary entries, quick notes, and saved references, with
  Task-linked Notes, Task/Note-linked References, complete-history text search,
  and exact Note tag filtering.
- Review workspace for seven-day evidence summaries, Project movement, and a
  period-bound narrative and next-period intention.
- Project attribution for activities, notes, and saved references.
- Global Capture palette with Task and Project search, typed Focus commands,
  URL and Note intent recognition, and draft-preserving handoff to the owning
  workspace.
- First-run guidance for genuinely empty workspaces, with complete-history
  readiness, durable first-Task recovery, working Project and Capture
  handoffs, and a phone-safe explanation of the core workflow.
- Browser-installable Dayflow identity with a standalone launch surface,
  deterministic branded icons, and explicit desktop and Apple metadata. The
  installed app still requires the local Dayflow server.
- Deadline-aware urgency that increases as a due date approaches.
- Portable, formula-safe CSV downloads for complete Task and Activity history,
  alongside a versioned JSON export for agents.

Product and corrective specifications:

- [Evidence Integrity v1](./docs/specs/EVIDENCE_INTEGRITY_V1.md)
- [Weekly Evidence Review v1](./docs/specs/WEEKLY_EVIDENCE_REVIEW_V1.md)
- [Local Data Reliability v1](./docs/specs/LOCAL_DATA_RELIABILITY_V1.md)
- [Migration Safety Backups v1](./docs/specs/MIGRATION_SAFETY_BACKUPS_V1.md)
- [Rolling Automatic Backups v1](./docs/specs/ROLLING_BACKUPS_V1.md)
- [Command Palette v1](./docs/specs/COMMAND_PALETTE_V1.md)
- [Manual Time Blocks v1](./docs/specs/TIME_BLOCKS_V1.md)
- [Activity Capture v1](./docs/specs/ACTIVITY_CAPTURE_V1.md)
- [Activity Editing v1](./docs/specs/ACTIVITY_EDITING_V1.md)
- [Journal Relationships v1](./docs/specs/JOURNAL_RELATIONSHIPS_V1.md)
- [Journal Search & Filtering v1](./docs/specs/JOURNAL_SEARCH_FILTERING_V1.md)
- [CSV Export v1](./docs/specs/CSV_EXPORT_V1.md)
- [First-Run Onboarding v1](./docs/specs/FIRST_RUN_ONBOARDING_V1.md)
- [PWA Installability v1](./docs/specs/PWA_INSTALLABILITY_V1.md)
- [Six-destination workspace decision](./docs/adr/0001-six-destination-workspace.md)

## Core Workflow

Dayflow uses one small loop rather than a setup system:

1. **Decide** what matters in Today or Backlog.
2. **Plan** actionable Tasks, finishable Projects, and Time Blocks.
3. **Record** what happened through Focus Sessions and Activities.
4. **Capture** useful context as Notes, Diary writing, and References.
5. **Review** the last seven days of evidence and choose what deserves
   protection next.

A genuinely empty workspace introduces this loop with one first Task plus
direct handoffs to Project creation and the global Capture palette. Any
meaningful persisted workspace record suppresses that empty-state onboarding,
even when the current day itself has nothing scheduled.

## Local Setup

Prerequisite: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Supported browsers can install Dayflow from their browser-managed install or
home-screen menu. Installation is bound to that exact local origin and does
not package or start Next.js, copy SQLite, or add offline behavior. Keep
`npm run dev` running to use the installed app. The default `127.0.0.1`
binding is reachable only from the same machine, not from a phone or another
device.

`npm run db:setup` creates and seeds the local SQLite database at
`prisma/dev.db` so a new dashboard has example data immediately. If the
database already contains Dayflow data, seeding is skipped and nothing is
deleted.

To deliberately replace a local database with the demo dataset:

```bash
npm run db:reset-demo
```

That command is destructive and should only be used when the existing local
data is disposable.

When updating an existing local checkout after a schema change, run:

```bash
npm run db:migrate
```

For a recognized existing Dayflow database, this first creates and verifies a
retained `dayflow-safety-before-migration-…dayflow-backup` artifact beside the
database, then applies checked-in migrations and repeatable Evidence
reconciliation without reseeding personal data. A genuinely fresh database
does not need a safety artifact. If migration fails after protection is
established, the command reports the retained artifact and an explicit
`db:restore` recovery command; it does not claim or attempt automatic rollback.

## Checks

Run the same complete reliability gate used by CI:

```bash
npm run check
```

The command generates the Prisma client, checks types, and runs the unit,
backup/restore, migration, production-build, and Chromium browser gates. It
requires the `sqlite3` command-line tool and a one-time local browser install
with `npm run test:e2e:install`. Every destructive database scenario uses a
disposable database outside the normal local data path.

Individual gates remain available:

```bash
npm run test:unit
npm run test:backup
npm run test:migrations
npm run typecheck
npm run build
```

## Browser Tests

Install Playwright's Chromium browser once:

```bash
npm run test:e2e:install
```

Then run the end-to-end suite:

```bash
npm run test:e2e
```

The checked-in PWA icons are generated from deterministic geometric artwork.
Regenerate them after an intentional brand change with:

```bash
npm run pwa:icons
```

The suite starts Dayflow on `http://127.0.0.1:3100` and uses a disposable
`dayflow-playwright.db` SQLite database in the operating system's temporary
directory. It does not read or write the normal local database at
`prisma/dev.db`.

## Local Data

The local database and `.env` file are intentionally excluded from Git. This
keeps personal tasks, notes, diary entries, and machine-specific configuration
out of the repository. `.env.example` contains the safe configuration template
needed for a new local setup.

Dayflow resolves the active SQLite database from `DATABASE_URL` (or from
`DATABASE_URL` in `.env`) and prints its absolute path before backup or restore
work. It never guesses a database when that setting is missing.

Create a complete backup with:

```bash
npm run db:backup
```

By default, the command writes a timestamped `.dayflow-backup` artifact in a
`backups` directory next to the active database. To choose a destination:

```bash
npm run db:backup -- --output /path/to/dayflow.dayflow-backup
```

The artifact contains a consistent SQLite snapshot and a versioned manifest
with its creation time, schema migration version, per-table record counts,
payload size, and checksum. It is written to a temporary file, validated, and
atomically renamed only when complete. Backup creation reads a snapshot and
does not mutate application records.

Dayflow can also create backups on its own schedule. Automatic backups are
off until you turn them on in **Data & backups**, where you choose an interval
and how many copies you want to keep. Dayflow creates and verifies them through
exactly the same path as a manual backup, and reports when the last one ran and
when the next is due.

Automatic backups never delete anything. When more copies exist than you asked
to keep, Dayflow says so and names the directory; removing them stays your
choice. They are created while Dayflow is running, so a machine that never
starts Dayflow is never backed up, and they live beside your database rather
than off the machine. Use the download button to keep a copy elsewhere.

The same recovery path is available from **Data & backups** in Dayflow. The
dialog creates backups in the managed `backups` directory, verifies their
checksums before offering restore, shows schema and record-count details, and
provides a download link for keeping a copy elsewhere. The dialog also
downloads complete Task and Activity history as separate UTF-8 CSV files for
spreadsheets and analysis. CSV is portable but is not a restore format.

For safety, the UI does not replace SQLite while the running app has database
connections open. After an explicit `RESTORE` confirmation it schedules the
verified artifact for the next Dayflow startup. Restart Dayflow to apply it;
startup first revalidates the selected checksum. If that pre-replacement check
fails, the active database remains in place and no safety copy is needed. For a
valid artifact, startup creates a separate safety backup of the latest active
database before atomic replacement. A failure before replacement leaves the
active database unchanged. If the process stops or final durability
confirmation fails after replacement has begun, verify the active data and use
the reported safety backup if recovery is needed. The outcome is reported in
the dialog after startup.

Restore replaces the current dataset. Stop the Dayflow development server
first, then run:

```bash
npm run db:restore -- --from /path/to/dayflow.dayflow-backup --confirm-replace
```

When an active database exists, restore first creates and reports a separate
safety backup. If the working database was deleted, restore reports that no
safety copy was needed and atomically recreates it. The command validates the
supplied artifact and all record counts, checks SQLite integrity,
relationships, the exact current schema, and migration checksums, restores into
a temporary database, runs checked-in migrations there, and only then installs
the result. If validation or migration fails, an existing active database is
left in place and its safety backup is retained. Restore v1 replaces data; it
does not merge datasets.

The backup and migration commands require the `sqlite3` command-line tool.
`npm run dev` binds to `127.0.0.1` so the local data controls are not exposed
to the network by default.

The local API exposes `/api/agent-export`, a versioned JSON export for analysis
and external agents. Unlike the dashboard bootstrap payload, this export is not
windowed: it includes every Task, schedule change, Project, Phase, Focus
Session, Note, Diary entry, Review, Material, Time Block, and Activity.

Complete human-readable CSV exports are available at `/api/exports/tasks` and
`/api/exports/activities`, as well as through **Data & backups**. They use
stable v1 columns, deterministic ordering, exact UTC timestamps where
applicable, local calendar fields, and formula-safe text cells.

JSON and CSV exports are supplemental and are not restore formats; use
`db:backup` and `db:restore` for lossless recovery.

## Project Notes

- [Project status and plan](PROJECT_STATUS.md)
- [Projects v1 feature specification](docs/specs/PROJECTS_V1.md)
- [Focus Timer v1 feature specification](docs/specs/FOCUS_TIMER_V1.md)
- [UX acceptance audit and next redesign batch](docs/UX_ACCEPTANCE_AUDIT_2026-07-23.md)
- [Dayflow domain language](CONTEXT.md)
- [Front-end development log](DAYFLOW_CHANGELOG.md)
