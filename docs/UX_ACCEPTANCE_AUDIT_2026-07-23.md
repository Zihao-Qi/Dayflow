# Dayflow UX Acceptance Audit

Date: July 23, 2026  
Scope: Today, unfinished-task handling, Focus Timer, Projects, backlog,
evidence tracking, reload persistence, responsive behavior, and accessibility
signals.

## Evidence Used

- The completed live walkthrough of the Focus Timer on `localhost:3000`.
- The passing 10-test Playwright suite using an isolated SQLite database.
- Current component behavior and responsive CSS.
- Earlier user questions, especially the ambiguity around “Backlog,” “Leave,”
  and the unit for the Project time field.

The isolated test suite verified that temporary test content does not touch the
normal local database. No audit records were added to the user's real data.

## Follow-Up Implementation

The first stabilization batch from this audit was implemented on July 23, 2026:

- app-level Timer ownership and the cross-destination active-session banner;
- contextual Start focus actions for Today and Project work;
- explicit Remove date and Keep on [date] unfinished-task actions;
- separate Project target duration and weekly effort fields;
- one-save task-title editing with visible status;
- meaningful-work cancellation confirmation;
- the tablet Activity-grid correction and initial accessibility feedback.

The larger navigation and Project-page restructuring recommendations remain
deferred until the stabilized workflow has been used with real work.

## What Is Working Well

- Project creation clearly separates the required name from optional details.
- Projects can contain both direct tasks and tasks inside optional Phases.
- Tasks belong to zero or one Project, and Project tasks may belong to zero or
  one Phase.
- Plan Progress and Invested Time are shown as separate, honest signals.
- Project deletion detaches related content instead of deleting it.
- Unfinished tasks are not silently moved to another day.
- Focus Sessions persist across reloads and correctly create Activity evidence.
- Focus can be linked to a Task, a Project, or neither.
- Mobile navigation remains visible without horizontal page overflow.
- Ongoing Areas and AI scheduling are appropriately deferred.

## High-Priority Friction

### 1. The timer is not truly app-wide

The Focus Timer component is mounted only while Today is selected. If the user
starts a timer and navigates to Plan, Journal, or Review, the timer remains in
the database but the ticking UI, automatic completion request, and browser
notification logic are no longer mounted. Completion is reconciled only after
the user returns to Today.

**Recommendation:** Move active-session ownership into a small app-level
provider. Keep the full setup panel on Today, but show a compact persistent
timer in the top bar on every destination.

### 2. Starting focus is disconnected from the work being viewed

The Timer's Task selector contains only unfinished tasks scheduled for Today.
A user viewing a Project task must schedule it for today, return to Today, find
it in the Timer selector, and then start. There is also no direct “Focus” action
on a Today task or Project next step.

**Recommendation:** Add contextual “Start focus” actions to Today tasks,
Project tasks, and the Project next-step card. These actions should prefill the
Task and inherited Project, leaving only the duration to choose.

### 3. “Backlog” and “Leave” are not self-explanatory

The current unfinished-task tray offers “Move to today,” an unlabeled date
picker, “Backlog,” and “Leave.” “Backlog” removes the scheduled date. “Leave”
only hides the item in the current browser state; it remains on its original
date and reappears after reload. The fact that this already required an
explanation is strong evidence of friction.

**Recommendation:**

- Rename “Backlog” to “Remove date.”
- Rename “Leave” to “Keep on Jul 18” when the date is known.
- If the intended behavior is temporary dismissal, call it “Skip for now” and
  state that it will return later.
- Give the date picker a visible label such as “Choose another day.”

### 4. The Project time field has conflicting meaning

The current UI and schema implement `weeklyMinutesBudget`, shown as “Weekly
time budget” with a minutes input. A value expressed in days or weeks describes
a Project duration or time horizon, not a weekly effort budget.

**Recommendation:** Keep two separate concepts:

- **Weekly effort budget:** minutes or hours per week.
- **Target duration:** an integer plus `days` or `weeks`.

Do not combine these into one field. Only display either value when the user
has filled it.

### 5. Today task titles save on every keystroke

Editing a Today task title calls the update API for each character. This creates
unnecessary requests and makes rapid edits vulnerable to out-of-order responses
or visible rollback. The UI also has no saving or failure state.

**Recommendation:** Keep a local draft and save on blur or after a short
debounce. Show a quiet saving/error indicator and retain the draft if saving
fails.

### 6. Projects are visually subordinate despite being a core workflow

Projects are the fourth option in a row containing Tasks, Timeline, Matrix, and
Projects. Timeline and Matrix are planning views; Projects are a different
planning level. Treating all four as peers makes the most important long-term
feature harder to discover.

**Recommendation:** Make Plan start with two primary modes: **Day plan** and
**Projects**. Put List, Timeline, and Matrix inside Day plan as secondary view
choices.

## Medium-Priority Friction

### Project pages become very long

A Project detail page stacks the hero, three metrics, next step, task creation,
Phases, Backlog, recent progress, Notes, and Materials. This will become
difficult to scan as real Projects grow.

Use a sticky section switcher or three internal views: **Overview**, **Plan**,
and **Evidence**. Keep the next step and progress summary visible in Overview.

### Backlog is split across two places

The general Plan backlog intentionally excludes Project tasks, while each
Project has its own backlog. This is logically valid but not obvious from the
generic “Backlog” heading.

Rename it “Standalone backlog,” or provide an “All backlog” view with Project
chips and filters.

### The tablet layout is uneven

Between 781px and 960px, the Today side area becomes a two-column grid with
three children: Daily Pulse, Focus Timer, and Activity. The third panel falls
into a new row with an unused neighboring column.

Make Activity span both columns at this breakpoint, or keep the entire side
area in one column.

### Canceling focus can discard meaningful work too easily

Cancel creates no Activity at any duration and currently has no confirmation.
That is appropriate for a false start, but risky after several minutes.

Confirm cancellation only after at least one elapsed minute, and explain that
the elapsed time will not be recorded. Keep immediate cancellation for very
short false starts.

### Project evidence has no path to the full history

Recent progress, Notes, and Materials are intentionally truncated, but there is
no “View all” route or action. Add a link to the corresponding filtered
Journal or Activity view when the lists exceed their preview limits.

### Accessibility needs a focused pass

- Today task title inputs need explicit accessible labels.
- Drag reordering needs a keyboard alternative.
- Save and API errors should use an `aria-live` region.
- Project Phase ordering should offer a less visually persistent action pattern
  as the number of Phases grows.

## Recommended Next Implementation Batch

This should be a focused usability batch, not a full visual rewrite:

1. Create app-level active timer state and a compact global timer.
2. Add contextual “Start focus” actions to Today and Project tasks.
3. Clarify unfinished-task wording and the Project time-field model.
4. Make task-title editing reliable with local draft/save feedback.
5. Fix the 781–960px Today layout and add the first accessibility corrections.

After this batch, use Dayflow for several days before redesigning Project
navigation or starting the macOS companion. The macOS MVP should then reuse the
validated timer contract and remain a small menu-bar controller rather than a
second full Dayflow interface.

## Acceptance Checklist for the Next Pass

- A running timer remains visible and completes while any main destination is
  open.
- Focus can be started from a Task or Project without manually selecting the
  same context again.
- Every unfinished-task action communicates what happens to the date.
- Weekly effort and target duration have distinct units and labels.
- Task title edits result in one reliable save with visible failure recovery.
- Tablet Today layout has no empty grid cell or cramped Activity form.
- All essential task and timer actions are keyboard accessible.
