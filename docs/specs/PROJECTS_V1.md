# Projects v1 Feature Specification

Status: Implemented  
Date: July 23, 2026

## Summary

Projects add one finishable layer above Dayflow tasks:

```text
Project
├── Direct task
├── Phase
│   ├── Task
│   └── Task
└── Phase
    └── Task
```

A Project represents an outcome such as completing an online course or finishing a research paper. Its tasks may be scheduled onto days or kept in an unscheduled backlog. Dayflow tracks both Plan Progress and Invested Time without requiring artificial precision.

Projects v1 is manual and predictable. It does not generate plans with AI, automatically arrange a calendar, or silently move unfinished tasks.

## Product Goals

- Let a user create a finishable Project in seconds.
- Organize Project work with optional Phases without requiring them.
- Connect daily tasks to longer-term outcomes.
- Keep future tasks in a backlog until the user schedules them.
- Show understandable progress and recorded effort for each Project.
- Let activities, notes, and materials contribute useful Project context.
- Help users resolve unfinished scheduled tasks without changing dates silently.
- Preserve Dayflow's current quiet, local-first, progressively disclosed interface.

## Non-Goals

Projects v1 will not include:

- Ongoing Areas such as Health, Learning, or Family.
- AI-generated phases, tasks, suggestions, or schedules.
- Automatic calendar arrangement.
- Automatic carry-forward of unfinished tasks.
- A Manual/Suggest/Automatic scheduling preference.
- Arbitrarily nested phases or subtasks.
- Tasks that belong to multiple Projects.
- Dependencies, Gantt charts, team ownership, or collaboration.
- Weighted progress based on estimated minutes.

These exclusions should not block later additions. In particular, Areas and optional AI planning remain explicit future directions.

## Domain Rules

### Project

- A Project describes a finishable outcome.
- `name` is the only required user-entered field.
- Optional metadata may include:
  - desired outcome;
  - target date;
  - target duration as a positive whole number of days or weeks;
  - weekly effort budget in minutes per week.
- A new Project starts as Active.
- Supported lifecycle states are Active, Paused, Completed, and Archived.
- Completing all current tasks does not automatically complete the Project.
- When all current tasks are done, Dayflow prompts the user to complete the Project or add another task.
- The user may explicitly complete a Project with unfinished tasks after confirming the choice.
- A Completed Project can be reopened.
- Adding unfinished work to a Completed Project requires reopening it.

### Phase

- A Phase belongs to exactly one Project.
- Phases cannot be nested.
- A Project may contain zero or more Phases.
- A Project task does not have to belong to a Phase.
- A Phase has no manually maintained lifecycle status in v1.
- A non-empty Phase appears complete when all its current tasks are done.
- An empty Phase is not considered complete.
- Adding an unfinished task to a complete Phase makes it incomplete again.
- Deleting a Phase moves its tasks to the Project root; it does not delete them.

### Task

- A Task belongs to zero or one Project.
- A Project task belongs to zero or one Phase in that same Project.
- A Task with no Project cannot belong to a Phase.
- A Task may have a scheduled day or no scheduled day.
- A task without a scheduled day is a Backlog Task.
- Existing standalone Dayflow tasks remain valid with no Project.
- Moving a Task between Projects removes any incompatible Phase assignment.
- Deleting a Task removes it from Project progress calculations.

### Project attribution

- A task-linked Activity inherits the Task's Project.
- An Activity without a Project task may link directly to one Project.
- A direct Project Activity and a task-linked Activity must not create conflicting Project attribution.
- Notes and Materials may link directly to one Project.
- Project-linked Notes and Materials do not affect Plan Progress or Invested Time.

## Progress

### Plan Progress

Plan Progress is:

```text
completed current tasks / all current tasks
```

It includes both direct Project tasks and tasks inside Phases, whether scheduled or in the backlog.

Examples:

- Six done tasks out of ten current tasks displays `6 of 10 tasks complete` and `60% of current plan`.
- A Project with no tasks displays `No tasks yet`, not `0% complete`.
- Adding new tasks may reduce the percentage because it changes the current plan.
- Removing tasks may increase the percentage.

The interface must use the phrase `current plan` anywhere a percentage could otherwise imply fixed-scope certainty.

### Invested Time

Invested Time is the sum of Activity durations attributed to the Project:

- activities linked to one of its tasks; plus
- activities linked directly to the Project.

Task estimates do not count as Invested Time. Notes, materials, task status changes, and diary entries do not add time.

A typical summary is:

> 6 of 10 tasks complete · 7h 40m invested

## Information Architecture

Projects will not add a fifth primary navigation destination in v1.

### Capture

- Add `New Project` to the existing Capture menu.
- Project creation emphasizes the required Name field.
- Optional metadata is available through progressive disclosure or after creation.

### Plan

- Plan has two primary modes: `Day plan` and `Projects`.
- List, Timeline, and Matrix are secondary views within Day plan.
- The Projects view shows Active Projects by default.
- Paused, Completed, and Archived Projects remain available through filters.
- Opening a Project replaces the Plan content with a full Project workspace.
- The Project workspace provides a clear `Back to Projects` action.
- Project detail has three internal views:
  - Overview for status, progress, invested time, and the next step;
  - Plan for task creation, optional Phases, scheduled work, and backlog;
  - Evidence for recorded Activity, linked Notes, and linked Materials.
- Project creation and small editing actions may use dialogs, but the full Project must not be confined to a side panel.

### Today

- Project-linked tasks display a quiet Project chip or breadcrumb.
- The chip opens the corresponding Project workspace.
- Project context must not dominate the task title or completion action.
- Unfinished scheduled tasks appear in a separate resolution tray rather than being mixed silently into today's plan.

### Activity

- The activity composer keeps its optional Task selector.
- Selecting a Project task automatically provides Project attribution.
- An optional Project selector supports direct Project activity when no Project task is selected.
- If the selected Task already belongs to a Project, the direct Project selector is hidden, disabled, or synchronized to prevent conflict.

### Journal

- Note and Material forms gain an optional Project selector.
- Project-linked Notes and Materials remain available in their canonical Journal views.
- The Project workspace shows its linked Notes and Materials as contextual collections.

### Review

- Review includes a compact `Projects moved forward` summary.
- A Project moved forward during the review period when it received a completed task or attributed Activity.
- Notes and Materials may appear as supporting evidence but do not independently mark progress.

## Project Workspace

The full Project workspace should prioritize the next useful action rather than management controls.

### Header

Show:

- Project name;
- lifecycle state when it is meaningful;
- Plan Progress;
- Invested Time;
- Edit and lifecycle actions.

Only display optional metadata that has a value. Do not render empty target-date,
target-duration, desired-outcome, or weekly-effort rows. Edit remains available
after creation.

### Work sections

The workspace includes:

1. **Next step** — the next scheduled or first available unfinished task, with an action to plan it.
2. **Phases and tasks** — direct tasks and optional Phase groups.
3. **Backlog** — unscheduled unfinished tasks, with scheduling actions.
4. **Recent progress** — recent completed tasks and attributed activities.
5. **Notes and materials** — linked Project context.

Empty sections should use quiet empty states and a single appropriate action.

## Creation and Editing

### Create

The shortest valid flow is:

1. Open `New Project`.
2. Enter a Name.
3. Create.

After creation, offer:

- `Add first task`;
- `Add a phase`;
- `Not now`.

Do not show `Suggest a plan` in v1.

### Edit

The user can later edit:

- name;
- desired outcome;
- target date;
- target duration in days or weeks;
- weekly effort budget;
- lifecycle state.

Optional fields disappear from the read view when cleared.

## Scheduling and Backlog

### Scheduling

- Scheduling a Backlog Task assigns it a day.
- Returning a Scheduled Task to the backlog clears its scheduled day.
- Project and Phase membership remain unchanged when a Task is scheduled or unscheduled.
- User-selected task order must remain stable within a day and within a Project/Phase list.

### Unfinished resolution

An Unfinished Task has a scheduled day before today and is not done. Dayflow does not mutate it automatically.

The next-day resolution tray offers:

- `Move to today`;
- `Choose another day`;
- `Return to Project backlog` for Project tasks, or the general backlog for standalone tasks;
- `Leave on original day`.

Rescheduling must preserve enough history to show where the Task came from and to support undo. At minimum, each schedule change records the Task, previous day, new day or backlog, timestamp, and action source.

Automatic carry-forward may be added later as an explicit preference, but `Ask me` is the permanent safe default.

## Lifecycle and Data Safety

### Pause

- Pausing keeps all Project content and progress.
- A Paused Project is excluded from the default Active list.
- Already scheduled tasks remain scheduled and visible; pausing does not silently move them.

### Complete

- Project completion always requires explicit user confirmation.
- Completing the final current task may trigger a completion prompt but never changes Project state on its own.
- Completing preserves tasks, activities, notes, materials, and progress history.

### Archive

- Archive is the normal non-destructive removal action.
- Archived Projects are hidden from the default Projects view.
- Archiving does not delete or reschedule associated content.
- An Archived Project can be restored.

### Delete

- Delete is an explicit, confirmed destructive action on the Project container only.
- Deleting a Project preserves associated Tasks, Activities, Notes, and Materials by detaching them.
- Direct and phased Project tasks become unassigned tasks.
- Project-owned Phase records are removed after their tasks are detached.
- Schedule history attached to preserved Tasks remains intact.

## Proposed Persistence Changes

The implementation should introduce the following concepts while preserving existing records:

### Project

- id
- name
- desiredOutcome, optional
- targetDate, optional
- targetDurationValue, optional positive integer
- targetDurationUnit, optional `DAYS | WEEKS` paired with targetDurationValue
- weeklyMinutesBudget, optional effort budget
- status
- createdAt
- updatedAt

### ProjectPhase

- id
- projectId
- name
- sortOrder
- createdAt
- updatedAt

### Task changes

- make the scheduled date optional;
- add optional projectId;
- add optional phaseId;
- maintain sort order for scheduled and Project contexts.

### ActivityEntry changes

- add optional direct projectId;
- derive effective Project attribution from the linked Task when applicable.

### Note and Material changes

- add optional projectId.

### TaskScheduleChange

- taskId
- previousDate, optional
- nextDate, optional
- source
- createdAt

Database and API validation must enforce the relationship invariants in this specification rather than relying only on the UI.

## API Requirements

- Project collection operations support list and create.
- Project detail operations support read, edit, lifecycle changes, and confirmed delete.
- Phase operations support create, rename, reorder, and delete-with-task-detachment.
- Task create and update operations accept optional Project, Phase, and scheduled day.
- Activity, Note, and Material operations accept optional direct Project attribution.
- A Project detail response includes all tasks and contextual records needed by the workspace.
- The daily bootstrap response may include lightweight Project summaries and Unfinished Tasks, but full Project histories should use the Project detail endpoint.
- Existing API clients that create dated standalone tasks must continue to work.

## Accessibility and Responsive Requirements

- Project creation, editing, task assignment, and scheduling must be usable by keyboard.
- Project and Phase progress cannot rely on color alone.
- Dialogs return focus to their trigger when closed.
- Project chips have accessible names that include the Project name.
- The Projects view and full workspace fit the existing mobile shell without horizontal overflow.
- Phase disclosure controls expose expanded state to assistive technology.

## Acceptance Criteria

Projects v1 is complete when:

- A Project can be created with only a Name.
- Optional metadata can be added, edited, cleared, and is shown only when filled.
- A user can add, rename, reorder, and delete Phases without losing their tasks.
- A Task can be attached to zero or one Project and optional valid Phase.
- A Project task can be scheduled or kept in the backlog.
- Existing standalone tasks continue to behave correctly.
- Project and Phase task-count progress updates correctly.
- Completing all tasks prompts but does not complete the Project.
- Invested Time includes direct and task-inherited Project activities exactly once.
- Notes and Materials can link to a Project and appear in both Journal and Project context.
- Projects appear inside Plan and open in the full Plan workspace.
- Project-linked Today tasks expose quiet Project context.
- Unfinished tasks are surfaced without automatic date mutation.
- Each unfinished-task resolution action behaves as specified and can be undone after a move.
- Pausing and archiving preserve content and scheduling.
- Deleting a Project detaches rather than deletes associated user content.
- Core Project flows have browser coverage on desktop and the existing narrow mobile viewport.

## Edge-Case Examples

### Scope grows

A Project has four tasks and all are done. Dayflow shows `4 of 4 tasks complete` and asks whether to complete the Project. If the user adds a fifth unfinished task instead, progress becomes `4 of 5`.

### Empty Phase

A user creates a Phase called `Final paper` but has not defined its tasks. The Phase appears empty, not complete.

### Phase deletion

A Phase contains three tasks. Deleting the Phase moves those tasks to the Project root, preserving their dates, statuses, activities, notes, and materials.

### Direct research time

A user records 45 minutes against a research Project without choosing a Task. Invested Time increases by 45 minutes; Plan Progress does not change.

### Task-linked time

A user records 30 minutes against a Task in the same Project. That activity contributes 30 minutes exactly once through the Task's Project.

### Unfinished work

A task scheduled for Tuesday is still open on Wednesday. It remains dated Tuesday until the user moves it to Wednesday, chooses another date, sends it to the backlog, or leaves it there.

### Project deletion

A user deletes a Project containing scheduled and backlog tasks. The Project and its Phases disappear, while all tasks and contextual records remain accessible without Project attribution.

## Deferred Direction

### Areas

Areas will represent ongoing responsibilities without a finishable outcome. They must remain a distinct concept rather than a special never-ending Project. A later specification should define how Areas relate to Projects, Tasks, Reviews, and recurring planning.

### AI and automatic planning

Later versions may:

- suggest editable Phases and one-sitting Tasks;
- preview capacity-aware schedules;
- explain why dates were suggested;
- support per-Project automatic carry-forward;
- learn from estimate accuracy and planning patterns.

AI proposals must remain reviewable before they create or schedule work. Deterministic scheduling constraints should control calendar placement.
