# Dayflow Project Status and Plan

Last updated: July 16, 2026

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

### Today View

- Shows today’s tasks.
- Supports adding tasks.
- Supports editing task titles inline.
- Supports completing and reopening tasks.
- Supports deleting tasks.
- Supports drag-and-drop task reordering using the task row grip handle.
- Supports task status, deadline, estimated minutes, urgency, and importance.
- Shows daily progress and planned vs actual time.
- Includes a compact mode toggle for denser task management.

### Urgency and Importance Matrix

- Shows tasks on an X-Y matrix:
  - X axis: urgency
  - Y axis: importance
- Tasks can be placed by selecting urgency and importance values.
- Tasks can be dragged directly on the matrix to update their urgency and importance.
- Urgency automatically increases when a task deadline gets close.
- Urgency selector uses five colored dots:
  - Left side is green for not urgent.
  - Right side is red for very urgent.
- Importance selector uses five colored dots:
  - Lower importance starts blue.
  - Higher importance moves toward green.
- Matrix quadrants are color-matched:
  - Important and urgent: red
  - Important and not urgent: green
  - Urgent and less important: blue
  - Neither urgent nor important: gray

### Planning View

- Shows today and future planning blocks.
- Shows unfinished tasks clearly.
- Includes a compact urgency and importance matrix for unfinished work.

### Notes and Diary

- Supports quick notes.
- Supports tags on notes.
- Supports daily diary content.
- Supports mood and energy sliders.
- Supports reflection content in the review flow.

### Materials Library

- Supports saving materials such as YouTube links, articles, websites, PDFs, or references.
- Stores title, URL, type, notes, and optional task attachment fields.
- Displays saved materials in a library-style list.

### Charts and Visualization

- Shows completion rate over recent days.
- Shows tasks completed.
- Shows planned vs actual time.
- Shows mood and energy trends.

### Front-End Polish and Responsiveness

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

- Summarizes today’s completion.
- Shows unfinished tasks.
- Provides a reflection area for planning tomorrow.

### Agent Integration Placeholder

- Includes a local export API route for external agent consumption:

```bash
/api/agent-export
```

This is intended as a future integration point for tools such as Hermes agent.

## Data and Local Setup

The project uses a local SQLite database:

```bash
prisma/dev.db
```

Schema and seed files:

- `prisma/schema.prisma`
- `prisma/init.sql`
- `prisma/seed.ts`

Useful commands:

```bash
npm run db:setup
npm run dev
npm run typecheck
npm run build
```

Note: the project currently uses `prisma/init.sql` plus `npm run db:setup` for local database setup. `prisma db push` previously had local schema-engine issues in this environment.

## Verification Completed

The following checks have passed:

```bash
npm run typecheck
npm run build
```

The app has also been opened and visually checked in Chrome at:

```bash
http://localhost:3000
```

Verified user-facing behavior includes:

- Dashboard loads successfully.
- Tasks are visible.
- Task completion works.
- Urgency and importance dot controls render without high/low text labels.
- Matrix is larger and diary appears lower on the page.
- Matrix quadrant colors match the urgency and importance color meanings.
- Task rows can be reordered by dragging the grip handle.
- Compact mode is available from the top toolbar.
- Notes and Materials show empty states when there is no content.

Additional front-end debugging recorded in `DAYFLOW_CHANGELOG.md`:

- Fixed a client-side `useState` reference error in `TaskRow`.
- Recovered from a local Next.js `.next` cache issue by restarting the development server.

## Known Limitations

- There are no automated browser tests yet.
- Task drag-and-drop exists in the task list and matrix, but there are no automated tests covering those interactions yet.
- Actual time is stored on tasks, but there is no chronological activity log or start/stop timer.
- There are no user-defined activity categories for understanding how time is distributed across areas of life.
- The review flow does not yet produce a complete weekly evidence-of-progress summary.
- Export is currently agent-oriented JSON; CSV export, printable summaries, and full import are not implemented.
- The app is responsive but is not yet configured as an installable PWA.
- Notes and materials have fields for task linking, but the UI for attaching them to tasks is still limited.
- PDF upload/storage is not implemented yet; materials currently store reference URLs and notes.
- There is no hosted sync, authentication, or multi-device support yet.
- There is no real Hermes integration yet, only a local API/export placeholder.

## Near-Term Plan

### 1. Stabilize Front-End Interaction Quality

- Add browser tests for drag reordering, matrix placement, compact mode, and mobile navigation.
- Confirm touch behavior for drag interactions on mobile.
- Review keyboard accessibility for task reordering and dot rating controls.
- Keep Gemini-led front-end changes documented in `DAYFLOW_CHANGELOG.md`.

### 2. Improve Planning

- Add a simple day picker for planning future days.
- Allow moving unfinished tasks to tomorrow.
- Add quick creation of time blocks from tasks.

### 3. Add Activity and Time Logging

- Add an `ActivityEntry` model with start time, end time or duration, category, optional task link, and accomplishment note.
- Support manual activity entry first, followed by an optional start/stop timer.
- Use activity entries to calculate actual time in the Daily Pulse and review views.
- Allow custom activity categories while providing calm defaults such as deep work, learning, administration, health, and rest.
- Make rest and non-task activity valid records rather than treating all progress as task completion.

### 4. Strengthen Notes, Diary, and Materials

- Add UI for linking notes to tasks.
- Add UI for linking materials to tasks or notes.
- Add search and tag filtering for notes and materials.
- Consider markdown support for diary and notes.
- Add richer diary states for empty days and completed reviews.
- Add gentle prompts such as “What would make today feel complete?”, “Record a small win,” and “What should carry forward?”

### 5. Improve Reviews and Charts

- Add a weekly evidence-of-progress summary combining completed tasks, activity time, notes, materials, mood, and energy.
- Show time distribution by activity category.
- Add a cleaner planned vs actual time breakdown.
- Add mood and energy correlation with completion trends.
- Let users write or edit a short weekly narrative about what moved forward.

### 6. Add Local-First Durability and Portability

- Add export and import for all local data.
- Add CSV export for activity and task history alongside the existing JSON agent export.
- Add a printable or shareable weekly summary.
- Add a backup command or UI action.
- Consider using Prisma migrations once the local schema-engine issue is resolved.

### 7. Improve the App-Like Experience

- Add a web app manifest, icons, and installable PWA behavior.
- Define useful offline behavior and make local data status visible.
- Keep Dayflow’s quiet notebook visual identity instead of adopting a generic SaaS dashboard style.
- Add a short first-run explanation of the Decide → Plan → Record → Capture → Review loop.

### 8. Prepare for Future Hosted Version

- Keep API routes clean and typed.
- Separate local persistence assumptions from app logic.
- Add authentication only when hosting becomes a real requirement.
- Keep the agent export format stable and documented.

## Suggested Next Technical Steps

1. Design and add the `ActivityEntry` data model and a simple manual activity log.
2. Connect activity duration to Daily Pulse actual time and weekly review calculations.
3. Add focused browser tests for the main flows:
   - Add task
   - Complete task
   - Add activity
   - Add note
   - Add material
   - Update urgency and importance
   - Drag reorder tasks
   - Toggle compact mode
4. Add CSV export and a small data export/import UI.
5. Build the first weekly evidence-of-progress summary.
6. Improve task-to-note and task-to-material linking.
7. Add installable PWA metadata and verify offline/local behavior.
8. Add a handoff convention:
   - Gemini records front-end design and UI changes in `DAYFLOW_CHANGELOG.md`.
   - This file records product status, implementation status, limitations, and development plan.
9. Expand the README with the core Decide → Plan → Record → Capture → Review workflow as the app shape stabilizes.
