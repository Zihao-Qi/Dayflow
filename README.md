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
- Journal workspace for diary entries, quick notes, and saved references.
- Review workspace for reflection and seven-day progress patterns.
- Project attribution for activities, notes, and saved references.
- Global Capture menu for jumping directly to a task, activity, note, or reference.
- Deadline-aware urgency that increases as a due date approaches.
- Advanced tools such as compact density and agent export are kept in the Tools menu.

Product and corrective specifications:

- [Evidence Integrity v1](./docs/specs/EVIDENCE_INTEGRITY_V1.md)
- [Local Data Reliability v1](./docs/specs/LOCAL_DATA_RELIABILITY_V1.md)
- [Six-destination workspace decision](./docs/adr/0001-six-destination-workspace.md)

## Local Setup

Prerequisite: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

This applies checked-in migrations and repeatable evidence reconciliation
without reseeding personal data.

## Checks

```bash
npm run test:unit
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

The suite starts Dayflow on `http://127.0.0.1:3100` and uses a disposable
`dayflow-playwright.db` SQLite database in the operating system's temporary
directory. It does not read or write the normal local database at
`prisma/dev.db`.

## Local Data

The local database and `.env` file are intentionally excluded from Git. This
keeps personal tasks, notes, diary entries, and machine-specific configuration
out of the repository. `.env.example` contains the safe configuration template
needed for a new local setup.

## Project Notes

- [Project status and plan](PROJECT_STATUS.md)
- [Projects v1 feature specification](docs/specs/PROJECTS_V1.md)
- [Focus Timer v1 feature specification](docs/specs/FOCUS_TIMER_V1.md)
- [UX acceptance audit and next redesign batch](docs/UX_ACCEPTANCE_AUDIT_2026-07-23.md)
- [Dayflow domain language](CONTEXT.md)
- [Front-end development log](DAYFLOW_CHANGELOG.md)
