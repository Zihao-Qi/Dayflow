# Dayflow

Dayflow is a local-first personal productivity dashboard for planning tasks,
capturing notes and diary entries, saving reference materials, and reviewing
daily progress.

It is built with Next.js, TypeScript, SQLite, Prisma, Recharts, and
lucide-react. The app runs locally without accounts or hosted services.

## Features

- Focused Today view with task creation, completion, inline editing, drag reordering, daily pulse, and activity capture.
- Expandable task details keep status, deadline, estimate, urgency, and importance available without crowding each row.
- Optional List, Timeline, and Matrix planning views.
- Journal workspace for diary entries, quick notes, and saved references.
- Review workspace for reflection and seven-day progress patterns.
- Global Capture menu for jumping directly to a task, activity, note, or reference.
- Deadline-aware urgency that increases as a due date approaches.
- Advanced tools such as compact density and agent export are kept in the Tools menu.

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
`prisma/dev.db` so the dashboard has example data immediately.

## Checks

```bash
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
- [Front-end development log](DAYFLOW_CHANGELOG.md)
