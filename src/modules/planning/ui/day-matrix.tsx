"use client";

import { useEffect, useRef, useState } from "react";
import { formatMinutes, formatShortDate } from "@/components/dashboard-formatters";
import { markDocumentResizing } from "@/components/use-layout-mode";
import { localDateKey } from "@/lib/dates";
import type { ProjectSummary } from "@/lib/project-domain";
import {
  daysUntilTaskDeadline,
  matrixFigurePoint,
  matrixGroups,
  matrixProjectColor,
  matrixProjectName,
  matrixTableGeometry,
  taskQuadrant,
  type BacklogArrange,
  type FocusTarget,
  type Task
} from "@/modules/planning/ui/backlog-model";

export function DayMatrix({
  tasks,
  today,
  projects,
  arrangement,
  preferredProjectId,
  activeTaskId,
  onStartFocus,
  onUpdateTask
}: {
  tasks: Task[];
  today: string;
  projects: Map<string, ProjectSummary>;
  arrangement: BacklogArrange;
  preferredProjectId?: string | null;
  activeTaskId: string | null;
  onStartFocus: (target: FocusTarget) => void;
  onUpdateTask: (
    id: string,
    patch: Partial<Task> & { scheduleSource?: string }
  ) => Promise<unknown>;
}) {
  const mode = arrangement === "figure" ? "figure" : "tables";
  const [layout, setLayout] = useState<"figure" | "tables">(mode);
  const [phase, setPhase] = useState<"closed" | "open">("open");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previousStageWidth = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const visibleTasks = tasks.filter((task) => task.status !== "DONE").slice(0, 60);
  const groups = matrixGroups(
    visibleTasks,
    today,
    projects,
    arrangement,
    preferredProjectId
  );
  const tableGeometry = matrixTableGeometry(groups, stageWidth);
  const stageHeight = tableGeometry.height;

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    },
    []
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (previousStageWidth.current === null) {
        previousStageWidth.current = width;
        setStageWidth(width);
        return;
      }
      if (Math.abs(previousStageWidth.current - width) < 0.5) return;
      previousStageWidth.current = width;
      markDocumentResizing();
      setStageWidth(width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next = arrangement === "figure" ? "figure" : "tables";
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    if (next === "tables") {
      setLayout("tables");
      setPhase("closed");
      transitionTimer.current = window.setTimeout(() => setPhase("open"), 190);
    } else {
      setPhase("closed");
      transitionTimer.current = window.setTimeout(() => {
        setLayout("figure");
        setPhase("open");
      }, 130);
    }
  }, [arrangement]);

  const calloutTask =
    visibleTasks.find((task) => task.id === (hovered ?? selected)) ?? null;
  const selectedTask = visibleTasks.find((task) => task.id === selected) ?? null;

  return (
    <section className="day-view matrix-5a">
      <div
        ref={stageRef}
        className={`matrix-stage matrix-layout-${layout} matrix-phase-${phase}`}
        style={{ height: layout === "tables" ? `${stageHeight}px` : "386px" }}
      >
        <div className="matrix-figure-furniture">
          <span className="matrix-axis-y">Importance →</span>
          <div className="matrix-figure-plot">
            <span className="figure-quadrant schedule">Schedule</span>
            <span className="figure-quadrant do-now">Do now</span>
            <span className="figure-quadrant later">Later</span>
            <span className="figure-quadrant quick">Quick wins</span>
          </div>
          <div className="matrix-axis-x">
            <span>7+ days out</span>
            <strong>Urgency →</strong>
            <span>due today</span>
          </div>
          {calloutTask && (
            <div
              className="matrix-hover-callout"
              style={{
                top: `${matrixFigurePoint(calloutTask, today, stageWidth).y - 18}px`,
                left: `${Math.min(520, stageWidth || 520) + 24}px`
              }}
            >
              <strong>{calloutTask.title}</strong>
              <span>
                {taskQuadrant(calloutTask, today).shortLabel} ·{" "}
                {matrixProjectName(calloutTask, projects)} ·{" "}
                {formatMinutes(calloutTask.estimateMinutes)}
                {calloutTask.deadline
                  ? ` · due ${formatShortDate(calloutTask.deadline)}`
                  : ""}
              </span>
            </div>
          )}
        </div>
        {groups.map((group) => {
          const geometry = tableGeometry.groups.get(group.id);
          if (!geometry) return null;
          return (
            <header
              className={`matrix-table-heading arrangement-${arrangement} quadrant-${group.id}`}
              key={group.id}
              style={{ top: `${geometry.top}px` }}
            >
              {group.rank ? (
                <span>{group.rank}</span>
              ) : group.dotColor ? (
                <span className="matrix-project-dot" style={{ background: group.dotColor }} />
              ) : (
                <span aria-hidden="true" />
              )}
              <div>
                <strong>{group.name}</strong>
                <small>{group.definition}</small>
              </div>
              <b>
                {group.tasks.length} ·{" "}
                {formatMinutes(
                  group.tasks.reduce((sum, task) => sum + task.estimateMinutes, 0)
                )}
              </b>
              <div className="matrix-column-heads">
                <span>Task</span>
                <span>Project</span>
                <span>Time</span>
                <span>Due</span>
              </div>
            </header>
          );
        })}
        {visibleTasks.map((task, index) => {
          const figure = matrixFigurePoint(task, today, stageWidth);
          const table = tableGeometry.tasks.get(task.id) ?? { x: 14, y: 15 };
          const color = matrixProjectColor(task.projectId);
          const position = layout === "tables" ? table : figure;
          const diameter =
            layout === "tables"
              ? 8
              : Math.min(36, Math.max(10, 9 + task.estimateMinutes * 0.13));
          const dueSoon = daysUntilTaskDeadline(task, today) <= 1;
          return (
            <button
              key={task.id}
              className={`matrix-persistent-task ${activeTaskId === task.id ? "running" : ""} ${dueSoon ? "due-soon" : ""}`}
              style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${diameter}px`,
                height: `${diameter}px`,
                backgroundColor: color,
                transitionDelay: `${(index % 5) * 22}ms`
              }}
              aria-label={`${task.title}, ${matrixProjectName(task, projects)}, ${formatMinutes(task.estimateMinutes)}`}
              onMouseEnter={() => setHovered(task.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(task.id)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                if (mode === "figure") {
                  setSelected(task.id);
                  return;
                }
                onStartFocus({
                  taskId: task.id,
                  projectId: task.projectId ?? undefined,
                  label: task.title,
                  plannedMinutes: task.estimateMinutes
                });
              }}
            >
              <span className="matrix-row-unroll">
                <span className="matrix-row-content">
                  <strong>{task.title}</strong>
                  <span className="matrix-row-project">
                    <i style={{ backgroundColor: color }} />
                    {matrixProjectName(task, projects)}
                  </span>
                  <time>{formatMinutes(task.estimateMinutes)}</time>
                  <time className={task.deadline ? "has-deadline" : ""}>
                    {task.deadline ? formatShortDate(task.deadline) : "—"}
                  </time>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {mode === "figure" && selectedTask && (
        <div className="matrix-selection-caption">
          <span>
            <strong>{selectedTask.title}</strong>
            <small>
              {taskQuadrant(selectedTask, today).shortLabel} ·{" "}
              {matrixProjectName(selectedTask, projects)} ·{" "}
              {formatMinutes(selectedTask.estimateMinutes)}
            </small>
          </span>
          <label className="pick-day-button compact">
            Pick day
            <input
              type="date"
              aria-label={`Pick a day for ${selectedTask.title}`}
              onChange={(event) => {
                if (event.target.value) {
                  void onUpdateTask(selectedTask.id, {
                    date: event.target.value,
                    scheduleSource: "backlog-matrix-date"
                  });
                }
              }}
            />
          </label>
          <button
            className="secondary-button"
            onClick={() =>
              void onUpdateTask(selectedTask.id, {
                date: localDateKey(new Date(today)),
                scheduleSource: "backlog-matrix-today"
              })
            }
          >
            Today
          </button>
        </div>
      )}
    </section>
  );
}

