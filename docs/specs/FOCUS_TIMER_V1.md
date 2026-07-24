# Focus Timer v1

Status: Implemented  
Last updated: July 23, 2026

## Purpose

Dayflow’s Focus Timer turns planned work into honest evidence of time spent
without treating time as task completion. It belongs on Today, next to Daily
Pulse and Activity, because it supports the “do and capture” part of the daily
loop.

## v1 Scope

- Start a 25-minute, 50-minute, or custom 1–240 minute Focus Session.
- Optionally attach the session to one Task or one Project.
- Inherit Project attribution when the linked Task belongs to a Project.
- Allow only one running or paused session at a time.
- Persist the session in SQLite so it survives page reloads.
- Keep the active session mounted at the app level so it continues ticking
  while Today, Plan, Journal, or Review is open.
- Show a compact active-session banner outside Today.
- Allow Today tasks, Project tasks, and the Project next step to open the Timer
  with their Task and Project context prefilled.
- Pause, resume, finish early, or cancel.
- Complete automatically when planned time elapses while Dayflow is open.
- On reload, complete an overdue running timer from its persisted timestamps.
- Create a Deep Work Activity when a completed Focus Session contains at least
  one full elapsed minute.
- Cap recorded Activity time at the planned duration.
- Never complete the linked Task automatically.
- Suggest a short Break Session after focus: 5 minutes for a 25-minute block,
  10 minutes for 50 minutes or more, and a proportional short break for custom
  sessions.
- Keep Break Sessions out of Activity and Invested Time.
- Show today’s completed Focus Session count and focused minutes.
- Offer browser notifications only through an explicit permission action.

## Lifecycle Rules

`Running → Paused → Running` may repeat. An active session can end as Completed
or Canceled. Completed and Canceled are terminal.

Elapsed work is derived from timestamps minus accumulated paused time, rather
than trusting a browser interval. This keeps the value stable across tab
throttling and reloads.

Finishing before one full elapsed minute still records a completed Focus
Session with zero actual minutes, but creates no Activity. Canceling creates no
Activity at any duration.

## Interface

The inactive state shows presets, custom minutes when selected, optional Task
and Project selectors, and an optional intention. Only filled associations are
used.

The active state emphasizes the remaining time, intention, attribution, and
the three decisions that matter: pause or resume, finish, and cancel. After a
Focus Session completes, the user may start or dismiss the suggested break.
Canceling after at least one elapsed focus minute requires confirmation because
the elapsed time will not create Activity evidence.

## Data and Portability

Focus Session state is exposed through a small server/domain module rather than
being owned by the React component. This boundary is intentional: a future
macOS companion can monitor and manage the same lifecycle without duplicating
timer rules.

## Deferred

- Long-break cycles and automatic multi-round Pomodoro sequences.
- Configurable default presets, sounds, and notification styles.
- Menu-bar controls, global keyboard shortcuts, and a native macOS app.
- Hosted synchronization and multi-device coordination.
- AI scheduling or automatic task-plan generation.
- Ongoing Areas; these remain a separate future container from finishable
  Projects, as specified in Projects v1.
