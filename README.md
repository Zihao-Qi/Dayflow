# Dayflow

Dayflow is a local-first personal productivity dashboard for planning tasks,
capturing notes and diary entries, saving reference materials, and reviewing
daily progress.

It is built with Next.js, TypeScript, SQLite, Prisma, Recharts, and
lucide-react. The app runs locally without accounts or hosted services.

## Features

- Today dashboard with task creation, completion, inline editing, and drag-and-drop reordering.
- Manual activity log with time, duration, category, accomplishment note, and optional task linking.
- Five-point urgency and importance controls with an interactive priority matrix.
- Deadline-aware urgency that increases as a due date approaches.
- Planning, notes, diary, materials, review, and progress chart views.
- Local agent export endpoint at `/api/agent-export` for a future integration.

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
