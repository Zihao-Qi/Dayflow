"use client";

import { Plus } from "lucide-react";
import { PageHeader } from "@/components/workspace-ui";
import { ArrangementControl } from "@/modules/planning/ui/arrangement-control";
import { DayMatrix } from "@/modules/planning/ui/day-matrix";
import type {
  BacklogArrange,
  FocusTarget,
  Task
} from "@/modules/planning/ui/backlog-model";
import type { BacklogPageData } from "@/modules/planning/ui/use-backlog-page";

export type BacklogPageProps = BacklogPageData & {
  onOpenProject: (id: string) => void;
  activeTaskId: string | null;
  onStartFocus: (target: FocusTarget) => void;
  onUpdateTask: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<unknown>;
  onOpenPalette: () => void;
};

export function BacklogPage({
  figureArrangement,
  tasks,
  projects,
  today,
  arrangement,
  onArrangementChange,
  scopeProjectId,
  onClearScope,
  onOpenProject,
  activeTaskId,
  onStartFocus,
  onUpdateTask,
  onOpenPalette
}: BacklogPageProps) {
  const effectiveArrangement =
    !figureArrangement && arrangement === "figure" ? "quadrant" : arrangement;
  const arrangements: Array<[BacklogArrange, string]> = figureArrangement
    ? [
        ["quadrant", "Quadrant"],
        ["figure", "Figure"],
        ["project", "Project"],
        ["due", "Due"]
      ]
    : [
        ["quadrant", "Quadrant"],
        ["project", "Project"],
        ["due", "Due"]
      ];

  const explainer =
    effectiveArrangement === "figure"
      ? "Figure — position is the grouping. Hover a dot for its title."
      : effectiveArrangement === "quadrant"
        ? "Ranked by what deserves attention first. Deadlines lead within each quadrant, then importance."
        : effectiveArrangement === "project"
          ? "Grouped by project — all of them, separated."
          : "Grouped by when a decision is due: Today, Next three days, Later this week, then No deadline.";

  return (
    <div className="backlog-page page-stack">
      <PageHeader
        eyebrow={`Defined, not scheduled · ${tasks.length}`}
        title="Backlog"
        actions={
          tasks.length ? (
            <ArrangementControl
              value={effectiveArrangement}
              options={arrangements}
              onChange={onArrangementChange}
            />
          ) : null
        }
      />
      {!tasks.length ? (
        <section className="backlog-empty-state">
          <h2>Everything defined has a day</h2>
          <p>
            Work lands here when you capture it without choosing a date. An empty
            backlog is the healthy state, not a gap to fill.
          </p>
          <button className="secondary-button" onClick={onOpenPalette}>
            <Plus size={14} />
            Capture something<span className="desktop-shortcut"> · ⌘K</span>
          </button>
          <small>
            Arrange is hidden while the backlog is empty — there is nothing to regroup.
          </small>
        </section>
      ) : (
        <>
          <p className="view-explainer">
            Arrange the same {tasks.length} {tasks.length === 1 ? "task" : "tasks"} by
            pressure, project or deadline — nothing is ever filtered out.
          </p>
          <p className="backlog-arrangement-note">{explainer}</p>
          {scopeProjectId && projects.get(scopeProjectId) && (
            <div className="backlog-scope-bar">
              <span>
                All backlog tasks are visible ·{" "}
                <strong>{projects.get(scopeProjectId)?.name} first</strong>
              </span>
              <div>
                <button className="text-button" onClick={onClearScope}>
                  Restore project order
                </button>
                <button
                  className="secondary-button"
                  onClick={() => onOpenProject(scopeProjectId)}
                >
                  Back to project
                </button>
              </div>
            </div>
          )}
          <DayMatrix
            tasks={tasks}
            today={today}
            projects={projects}
            arrangement={effectiveArrangement}
            preferredProjectId={scopeProjectId}
            activeTaskId={activeTaskId}
            onStartFocus={onStartFocus}
            onUpdateTask={onUpdateTask}
          />
        </>
      )}
    </div>
  );
}

