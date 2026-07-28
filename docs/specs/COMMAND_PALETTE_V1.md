# Command Palette v1

Status: Implemented
Date: July 28, 2026

## Purpose

Dayflow's global **Search or add** control should be a truthful capture and
navigation surface. A person can type once, understand what will happen, and
hand the text to the right workspace without saving anything accidentally.

## v1 Scope

- Open from every workspace with the visible Capture control or
  <kbd>Command/Ctrl</kbd>+<kbd>K</kbd>.
- Show the existing quick actions when the query is empty.
- Search unfinished Tasks and active Projects.
- Interpret a small explicit command grammar:
  - `focus N` prepares a Focus Session lasting `N` whole minutes;
  - `note TEXT` hands `TEXT` to a new Note;
  - an absolute HTTP or HTTPS URL hands the URL to a new Reference.
- Treat other non-empty text as a new Task draft after any matching actions,
  Tasks, and Projects.
- Preserve typed text when handing it to Task, Note, and Reference forms.
- When a Focus Session is already live, expose it instead of offering a second
  session and add matching Tasks to the Focus Queue.

## Resolution Contract

Command resolution is pure and has no access to React, navigation, storage, or
network state. It receives the current query, unfinished Task summaries, active
Project summaries, and whether a Focus Session is live. It returns ordered
items with stable identities and typed semantic intents.

Empty-query actions have a fixed order:

1. Start a 50-minute Focus Session, or show the live Focus Session.
2. Draft a Task for today.
3. Draft a manual Activity.
4. Draft a Note.
5. Draft a Reference.

Up to three active Project suggestions may follow those actions so the empty
state preserves the palette's existing jump behavior.

Explicit grammars claim the whole query. `focus N` accepts only a base-10 whole
number from 1 through 240. A malformed Focus command, malformed URL-like value,
unsupported URL scheme, or overlong draft produces an honest validation
message and never falls through to a Task draft.

General matching is case-insensitive and whitespace-normalized. Exact and
prefix matches precede substring matches; ties are deterministic and do not
depend on source-array order. Every valid plain-text query ends with a Task
draft, so the palette never claims that useful capture text has no result.

## Handoff Semantics

Selecting a draft intent navigates to the owning workspace, prefills its
existing form, and focuses that form. Selection does not persist a Task, Note,
Reference, or Activity.

An empty quick action never clears an unsaved destination draft. Explicit Task,
Note, and Reference text replaces the corresponding form value as the selected
handoff.

Selecting a Task prepares a Task-linked Focus Session when no session is live.
During a live session, it adds the Task to the end of the Focus Queue instead.
Selecting a Project opens that Project.

## Keyboard and Accessibility

- Opening the palette focuses its combobox.
- Up and Down arrows move through a wrapping selection.
- Enter activates the selected item.
- Escape dismisses the dialog and returns focus to its opener when that opener
  still exists.
- Tab and Shift+Tab keep focus in the modal combobox.
- The global shortcut does not stack the palette over another modal dialog.
- The dialog, combobox, listbox, options, selected item, and validation message
  expose their state to assistive technology.
- The same interaction remains usable at phone, tablet, and desktop widths.

## Non-Goals

- Fuzzy or remote search.
- Searching completed Tasks, inactive Projects, Note history, or Reference
  history.
- Arbitrary plugins, user-defined aliases, or a public command registry.
- Persisting capture directly from the palette.
- Natural-language dates, recurring Tasks, or scheduling suggestions.

## Required Test Coverage

- Unit tests for command parsing, validation, ranking, stable identity, text
  normalization, and live-Focus behavior.
- Browser coverage for keyboard opening, Task/Note/Reference handoff, custom
  Focus duration, validation, arrow selection, Escape focus restoration, and a
  phone-sized capture flow.
