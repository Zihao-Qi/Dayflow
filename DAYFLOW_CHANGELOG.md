# Dayflow Front-End Optimization & Design Log

This document records the updates, bug fixes, and design enhancements implemented for the **Dayflow** dashboard during our session.

## Latest: Usability Stabilization

- **App-Wide Timer**: Timer lifecycle now stays mounted across all four primary
  destinations, with a compact active-session banner outside Today.
- **Contextual Focus**: Today tasks, Project tasks, and Project next steps can
  prefill the Focus Timer directly.
- **Safer Cancellation**: Canceling after one elapsed focus minute confirms
  that the time will not be recorded.
- **Clear Carry-Forward Language**: Replaced ambiguous Backlog and Leave actions
  with Remove date and Keep on [date], and gave the date picker a visible label.
- **Reliable Title Editing**: Today task titles save once after editing finishes
  and expose saving, saved, or failure feedback.
- **Honest Project Time Fields**: Target duration is now a whole number of days
  or weeks, separate from the weekly effort budget.
- **Tablet and Accessibility Pass**: Activity spans the tablet side grid, task
  titles have explicit labels, and async feedback uses live status text.

## Latest: Persistent Focus Timer

- **Today Integration**: Added a compact Focus Timer between Daily Pulse and Activity.
- **Flexible Durations**: Added 25/5 and 50/10 presets plus custom sessions from 1 to 240 minutes.
- **Honest Attribution**: Focus can link to one Task, one Project, or neither, with Project context inherited from a linked Task.
- **Persistent State**: Running and paused sessions are stored in SQLite and survive reloads.
- **Session Controls**: Added pause, resume, early finish, cancel, and a one-active-session invariant.
- **Activity Evidence**: Completed focus with at least one elapsed minute creates a Deep Work Activity; canceled work and Break Sessions do not.
- **Break Flow**: Added suggested breaks and optional browser completion notifications.
- **Portable Core**: Timer calculation and lifecycle rules live outside the React UI so a future macOS companion can share the same contract.
- **Browser Coverage**: Added an end-to-end test for attribution, pause/reload/resume persistence, completion, Activity recording, and starting a suggested break.

## Latest: Projects and Long-Term Progress

- **Projects in Plan**: Added a Projects view without expanding the four-item primary navigation.
- **Optional Phases**: Projects can group work into reorderable phases while still supporting direct Project tasks.
- **Project Backlogs**: Tasks can remain unscheduled and later be assigned to a day from the Project or general backlog.
- **Two Honest Progress Signals**: Project cards and workspaces show current-plan task progress separately from recorded invested time.
- **Project Workspace**: Added a full Plan workspace for next steps, phases, tasks, backlog, recent activity, notes, and materials.
- **Quiet Daily Context**: Today tasks show a compact Project chip, and existing tasks can be attached to a Project from expanded details.
- **Evidence Attribution**: Activities, notes, and materials can link directly to Projects; task-linked activity is inherited without double counting.
- **Safe Lifecycle**: Added pause, explicit completion, archive, reopen, and deletion that detaches rather than destroys associated content.
- **Unfinished Task Tray**: Past unfinished tasks stay on their original date until the user moves, reschedules, returns, leaves, or undoes them.
- **Responsive Coverage**: Added browser coverage for Project creation, phases, progress, evidence, carry-over undo, deletion safety, and mobile overflow.
- **Deferred Intentionally**: Ongoing Areas, AI task generation, automatic scheduling, and silent carry-forward remain future work.

## Latest: Simplification and Progressive Disclosure

- **Four Clear Destinations**: Consolidated the product around Today, Plan, Journal, and Review so each capability has one canonical home.
- **Focused Today View**: Reduced Today to active tasks, a compact daily pulse, and activity capture. Planning tools, diary, charts, notes, and references no longer compete in the same canvas.
- **Expandable Task Details**: Kept the default task row focused on completion, title, status, and estimate while moving urgency, importance, deadline, status editing, estimate editing, and deletion into an expandable detail area.
- **Optional Planning Tools**: Turned List, Timeline, and Matrix into selectable Plan views, keeping the matrix available without making it part of every daily workflow.
- **Unified Journal**: Moved diary, notes, and materials into Journal with a small internal view switcher and one canonical creation form for each content type.
- **Power Tools Menu**: Moved compact density and agent export out of primary navigation and into Tools.
- **Global Capture**: Added a Capture menu that routes directly to task, activity, note, or reference entry.
- **Mobile Hierarchy**: Removed the large desktop identity panel from the mobile content flow and reduced bottom navigation to four destinations.
- **Two-Axis Priority Color**: Simplified urgency to a gray-to-red scale and importance to a gray-to-blue scale. The planning matrix uses the same meanings, with their high-high overlap producing a derived purple “Do now” quadrant.

## 1. Layout & Responsiveness Fixes
Our initial priority was fixing layout overflows, overlapping elements, and unpredictable grid behaviors when resizing the browser window.

- **Bottom Task Controls Grid**: Fixed the issue where the "Deadline" date input was overlapping the "Status" dropdown. Transitioned the `.task-controls` row away from a rigid `1fr` CSS grid layout. We implemented a clean Flexbox layout (`flex-wrap: wrap`) with fixed widths. This prevents UI elements from "stretching" elastically on ultra-wide screens and ensures they gracefully wrap to a second line on narrow screens without squishing.
- **Input Field Standardization**: Reduced the vertical height of the Deadline picker, Status dropdown, and Time Estimate inputs to exactly `34px` with `13px` fonts. This aligns them perfectly with the Urgency/Importance dot containers, creating a uniform, highly compact row.
- **Long Text Overflow**: Applied `text-overflow: ellipsis` and extra right-padding to the Task Title input. This elegantly truncates long task titles with `...` instead of allowing the text to physically crash into the row action buttons.
- **Daily Pulse Responsiveness**: Fixed the bug where the `125m` text was overflowing out of its gray metric container. The metric boxes now use an `auto-fit` grid.
- **Right Panel Display Logic**: Hard-coded the Dashboard Grid so the right-side "Daily pulse" panel will never shrink below `380px`. This mathematically guarantees the 4 metric buttons will *always* fit neatly on one line while on the right side of the screen. If the screen is too narrow to provide `380px`, the entire right panel seamlessly drops underneath the main task list.

## 2. Deep Exploration UX/UI Enhancements
After auditing the application's overall design aesthetics, we implemented five major upgrades to make the interface feel more premium, tactile, and professional.

- **Native Drag-and-Drop**: Removed the clunky `^` (Up) and `v` (Down) chevron buttons entirely. We wired up the `GripVertical` icon (the 6 little dots) using the HTML5 Drag-and-Drop API. You can now physically pick up task rows and drag them to instantly reorder your day.
- **Flattened "Shadow" Aesthetic**: Removed the heavy, persistent drop-shadows from the default white `.panel` containers in favor of a clean, minimalist border design. We repurposed the shadow so it only appears when you pick up and drag a task row, providing excellent tactile feedback.
- **Interactive Button States**: Added snappy hover feedback (subtle background shifts, slight visual scaling, and red tints for destructive buttons) to all standard buttons, including the urgency/importance rating dots.
- **Welcoming Empty States**: Built elegant "Empty State" UI components for the **Notes** and **Materials** tabs. Instead of an empty white page, users now see a beautiful, faded icon and a friendly prompt telling them how to get started.
- **Mobile Bottom Bar**: Redesigned the mobile navigation. On screens smaller than `780px`, the top navigation links no longer stack into a chunky grid. Instead, they transform into a native-feeling fixed Bottom Tab Bar, maximizing vertical screen real estate for task management.
- **Compact Mode**: Built a new "Expand/Shrink" toggle in the top-right toolbar. This allows power users to activate a "Compact Mode" which dynamically shrinks internal padding, gaps, and font sizes across the workspace, drastically increasing task density on the screen.

## 3. Server & React Debugging
During the implementation phase, we successfully troubleshooted two local development server crashes:
- **Client-Side ReferenceError**: Fixed a white-screen React crash caused by attempting to use `React.useState` in the `TaskRow` component without importing the global `React` object. Swapped it to the destructured `useState` hook.
- **Next.js 500 Server Error**: Debugged an `ENOENT: no such file or directory` error caused by a background build process temporarily deleting the `.next` development cache directory. Cleanly restarted the local server to restore normal access.
