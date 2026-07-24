# Dayflow Project Status and Plan

Last updated: July 23, 2026

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

The interface was simplified in July 2026 around four clear destinations:
Today, Plan, Journal, and Review. Frequent actions remain immediately
available, contextual details expand when needed, and infrequent data or
density controls live in Tools.

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
- Keeps active timer management mounted across Today, Plan, Journal, and Review,
  with a compact banner outside Today.
- Lets Today and Project task actions prefill the Timer directly.
- Supports 25-minute and 50-minute focus presets plus any custom duration from 1 to 240 minutes.
- Allows a session to link to a Task, a Project, or neither; Project context is inherited from a linked Task.
- Keeps one running or paused session across page reloads.
- Supports pause, resume, finish early, and cancel.
- Converts completed Focus Sessions with at least one elapsed minute into Deep Work Activity evidence.
- Keeps Break Sessions separate from Activity time and suggests an appropriate break after focus.
- Shows today’s completed Focus Sessions and focused minutes.
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

### Projects and Multi-Layer Planning

- Adds finishable Projects inside Plan without adding another primary navigation destination.
- Supports optional Phases while allowing tasks to live directly at the Project root.
- Lets Project and standalone tasks remain unscheduled in a backlog.
- Uses completed-task count for current-plan progress and recorded Activity time for invested effort.
- Requires explicit Project completion and derives Phase completion from current tasks.
- Supports Active, Paused, Completed, and Archived Project states.
- Preserves associated tasks, activities, notes, and materials when a Project container is deleted.
- Lets activities, notes, and materials link directly to Projects.
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

- Supports manually recording what happened during the day.
- Stores activity time, duration, category, accomplishment note, and an optional linked task.
- Includes calm default categories for deep work, learning, administration, health, and rest.
- Uses activity durations as the source for Daily Pulse spent time and weekly actual-time charts.
- Supports deleting activity entries.
- Includes activities in the local agent export.
- Uses task-level actual minutes only as a compatibility fallback on days without activity entries.

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

### Planning View

- Offers List, Timeline, and Matrix views instead of displaying every planning tool at once.
- Shows unfinished tasks clearly in the default list view.
- Keeps the urgency and importance matrix available as an optional power tool.

### Notes and Diary

- Groups diary, notes, and references under one Journal destination.
- Supports quick notes.
- Supports tags on notes.
- Supports daily diary content.
- Supports mood and energy sliders.
- Supports reflection content in the review flow.

### Materials Library

- Lives in the Journal as the canonical place to browse and save references.
- Supports saving materials such as YouTube links, articles, websites, PDFs, or references.
- Stores title, URL, type, notes, and optional task attachment fields.
- Displays saved materials in a library-style list.

### Charts and Visualization

- Lives in Review rather than competing with today's work.
- Shows completion rate over recent days.
- Shows tasks completed.
- Shows planned vs actual time.
- Shows mood and energy trends.

### Front-End Polish and Responsiveness

- Uses four primary destinations: Today, Plan, Journal, and Review.
- Removes duplicated notes, materials, diary, matrix, and chart surfaces from Today.
- Adds a global Capture menu that routes directly to the relevant canonical form.
- Moves compact density and agent export into a Tools menu for progressive disclosure.
- Hides the desktop brand panel on mobile while keeping the four-item bottom navigation visible.
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
The endpoint is exposed through the Tools menu instead of primary navigation.

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
npm run test:e2e
npm run typecheck
npm run build
```

The Playwright browser suite runs against a disposable SQLite database in the
operating system's temporary directory. It covers focus-session persistence and
Activity recording, activity deletion, task completion, section navigation,
compact mode, task reordering, matrix placement, Project workflows, and narrow
mobile navigation.

The app has also been opened and visually checked in Chrome at:

```bash
http://localhost:3000
```

Verified user-facing behavior includes:

- Dashboard loads successfully.
- Tasks are visible.
- Task completion works.
- Urgency and importance dot controls render without high/low text labels.
- Matrix is available from the optional Plan view.
- Matrix quadrant colors match the urgency and importance color meanings.
- Task rows can be reordered by dragging the grip handle.
- Advanced task fields expand only when requested.
- Compact density and agent export are available from Tools.
- Journal provides canonical Diary, Notes, and Materials views.
- Focus Sessions can be started, paused, restored after reload, and canceled from Today.
- The mobile shell uses four bottom navigation items without horizontal overflow.

Additional front-end debugging recorded in `DAYFLOW_CHANGELOG.md`:

- Fixed a client-side `useState` reference error in `TaskRow`.
- Recovered from a local Next.js `.next` cache issue by restarting the development server.

## Known Limitations

- Automated browser coverage currently targets Chromium; Firefox and WebKit are not covered yet.
- Touch-specific drag behavior still needs manual verification on a physical mobile device.
- Focus Timer sessions are single-device and depend on the local Dayflow process; there is no menu-bar or system-wide macOS timer yet.
- Focus and break lengths are chosen per session; configurable default presets and long-break cycles are not implemented yet.
- Activity entries cannot be edited yet.
- Activity categories use a fixed default list; user-defined categories are not implemented yet.
- Activity entry is currently focused on today rather than retrospective logging for another date.
- The review flow does not yet produce a complete weekly evidence-of-progress summary.
- Export is currently agent-oriented JSON; CSV export, printable summaries, and full import are not implemented.
- The app is responsive but is not yet configured as an installable PWA.
- Notes and materials have fields for task linking, but the UI for attaching them to tasks is still limited.
- PDF upload/storage is not implemented yet; materials currently store reference URLs and notes.
- There is no hosted sync, authentication, or multi-device support yet.
- There is no real Hermes integration yet, only a local API/export placeholder.

## Near-Term Plan

### 1. Stabilize Front-End Interaction Quality

- Keep browser coverage for drag reordering, matrix placement, compact mode, activity logging, and mobile navigation passing as the interface evolves.
- Confirm touch behavior for drag interactions on mobile.
- Review keyboard accessibility for task reordering and dot rating controls.
- Keep Gemini-led front-end changes documented in `DAYFLOW_CHANGELOG.md`.

### 2. Improve Planning

- Add a simple day picker for planning future days.
- Add quick creation of time blocks from tasks.
- Explore capacity-aware scheduling suggestions only after the manual Projects workflow has been validated.

### 3. Extend Activity and Time Logging

- Add editing for activity entries.
- Validate Focus Timer defaults and break suggestions through daily use.
- Explore a small macOS companion only after the web timer workflow is stable.
- Add custom activity category management.
- Allow retrospective activity logging for another date.
- Keep rest and non-task activity valid records rather than treating all progress as task completion.

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

1. Add focused browser tests for the main flows:
   - Add task
   - Complete task
   - Add activity
   - Add note
   - Add material
   - Update urgency and importance
   - Drag reorder tasks
   - Toggle compact mode
2. Build the first weekly evidence-of-progress summary from tasks, activities, diary state, notes, and materials.
3. Add CSV export and a small data export/import UI.
4. Add activity editing, custom categories, and an optional timer.
5. Improve task-to-note and task-to-material linking.
6. Add installable PWA metadata and verify offline/local behavior.
7. Add a handoff convention:
   - Gemini records front-end design and UI changes in `DAYFLOW_CHANGELOG.md`.
   - This file records product status, implementation status, limitations, and development plan.
8. Expand the README with the core Decide → Plan → Record → Capture → Review workflow as the app shape stabilizes.
