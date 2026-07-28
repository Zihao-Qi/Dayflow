---
status: accepted
date: 2026-07-27
---

# Use six destinations for the Dayflow workspace

Dayflow uses Today, Log, Projects, Backlog, Journal, and Review as distinct
workspace destinations. This supersedes the Projects v1 information-architecture
decision to place Projects inside Plan: the shipped daily loop benefits from
stable, directly addressable places for doing, historical planning, outcomes,
unscheduled work, capture, and reflection, while responsive navigation can
condense access without changing those concepts.

## Considered Options

- Keep a two-level Plan destination containing Day plan and Projects.
- Use six stable destinations and adapt only their navigation presentation by
  viewport.

The six-destination model was chosen because it matches the validated running
product and avoids hiding Backlog and Projects behind changing subnavigation.

## Consequences

- Desktop and wide layouts expose all six destinations.
- Narrow layouts may place secondary destinations under More, but the
  destinations and their content ownership do not change.
- Today owns today's deliberate work and unfinished-task resolution.
- Log owns historical scheduled work and recorded daily activity.
- Projects owns finishable outcomes and their plans.
- Backlog owns unscheduled Tasks and their arrangements.
- Journal owns Diary, Notes, and Materials.
- Review owns period-based evidence and reflection.
- The Focus rail is contextual chrome, not a seventh destination.
- Capture/search controls may open creation workflows or navigate to a
  destination, but they do not become another canonical home for records.
- The Information Architecture section of `PROJECTS_V1.md` is superseded by this
  decision. Its Project domain rules remain in force.
