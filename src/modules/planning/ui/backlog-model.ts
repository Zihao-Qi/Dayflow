import { formatShortDate } from "@/components/dashboard-formatters";
import type { FocusDraft } from "@/lib/focus-draft";
import type { ProjectSummary } from "@/lib/project-domain";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
export type BacklogArrange = "figure" | "quadrant" | "project" | "due";
export type FocusTarget = Omit<FocusDraft, "revision">;
export type Task = {
  id: string;
  title: string;
  date: string | null;
  status: TaskStatus;
  priority: Priority;
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  focusQueuePosition: number | null;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

type MatrixQuadrantId = "do-now" | "schedule" | "quick-wins" | "later";
type MatrixGroup = {
  id: string;
  rank?: number;
  name: string;
  definition: string;
  dotColor?: string;
  tasks: Task[];
};

export function taskQuadrant(task: Task, today: string) {
  const important = task.importanceScore >= 3;
  const urgent = effectiveUrgentScore(task, today) >= 3;
  if (important && urgent) {
    return {
      id: "do-now" as const,
      label: "Do now — important and urgent",
      shortLabel: "Do now"
    };
  }
  if (important) {
    return {
      id: "schedule" as const,
      label: "Schedule — important, not urgent",
      shortLabel: "Schedule"
    };
  }
  if (urgent) {
    return {
      id: "quick-wins" as const,
      label: "Quick wins — urgent, less important",
      shortLabel: "Quick wins"
    };
  }
  return {
    id: "later" as const,
    label: "Later — neither urgent nor important",
    shortLabel: "Later"
  };
}

export function matrixGroups(
  tasks: Task[],
  today: string,
  projects: Map<string, ProjectSummary>,
  arrangement: BacklogArrange,
  preferredProjectId?: string | null
): MatrixGroup[] {
  if (arrangement === "project") {
    const projectIds = [
      ...new Set(tasks.map((task) => task.projectId ?? "standalone"))
    ].sort((a, b) => {
      if (a === preferredProjectId) return -1;
      if (b === preferredProjectId) return 1;
      return (
        a === "standalone" ? "Standalone" : projects.get(a)?.name ?? "Project"
      ).localeCompare(
        b === "standalone" ? "Standalone" : projects.get(b)?.name ?? "Project"
      );
    });
    return projectIds.map((projectId) => ({
      id: `project-${projectId}`,
      name:
        projectId === "standalone"
          ? "Standalone"
          : projects.get(projectId)?.name ?? "Project",
      definition:
        projectId === "standalone"
          ? "Independent work"
          : "Project work · all unscheduled tasks",
      dotColor: matrixProjectColor(projectId === "standalone" ? null : projectId),
      tasks: sortBacklogGroup(
        tasks.filter((task) => (task.projectId ?? "standalone") === projectId)
      )
    }));
  }

  if (arrangement === "due") {
    const definitions = [
      {
        id: "due-today",
        name: "Today",
        definition: "Due now",
        includes: (task: Task) => Boolean(task.deadline) && daysUntilTaskDeadline(task, today) <= 0
      },
      {
        id: "due-next-three",
        name: "Next three days",
        definition: "Close enough to decide",
        includes: (task: Task) => {
          const days = daysUntilTaskDeadline(task, today);
          return Boolean(task.deadline) && days > 0 && days <= 3;
        }
      },
      {
        id: "due-later-week",
        name: "Later this week",
        definition: "Visible, not immediate",
        includes: (task: Task) => Boolean(task.deadline) && daysUntilTaskDeadline(task, today) > 3
      },
      {
        id: "due-none",
        name: "No deadline",
        definition: "Date it or drop it",
        includes: (task: Task) => !task.deadline
      }
    ];
    return definitions
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        definition: definition.definition,
        tasks: tasks
          .filter(definition.includes)
          .sort(
            (a, b) =>
              b.importanceScore - a.importanceScore ||
              b.urgentScore - a.urgentScore ||
              a.sortOrder - b.sortOrder
          )
      }))
      .filter((group) => group.tasks.length > 0);
  }

  const definitions: Array<{
    id: MatrixQuadrantId;
    rank: number;
    name: string;
    definition: string;
  }> = [
    { id: "do-now", rank: 1, name: "Do now", definition: "Important and urgent" },
    { id: "schedule", rank: 2, name: "Schedule", definition: "Important, not urgent" },
    { id: "quick-wins", rank: 3, name: "Quick wins", definition: "Urgent, less important" },
    { id: "later", rank: 4, name: "Later", definition: "Neither" }
  ];
  return definitions.map((definition) => ({
    ...definition,
    tasks: sortBacklogGroup(
      tasks.filter((task) => taskQuadrant(task, today).id === definition.id)
    )
  }));
}

export function sortBacklogGroup(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    if (a.deadline && b.deadline) {
      return (
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime() ||
        b.importanceScore - a.importanceScore
      );
    }
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.importanceScore - a.importanceScore || a.sortOrder - b.sortOrder;
  });
}

export function matrixTableGeometry(groups: MatrixGroup[], stageWidth = 0) {
  const groupGeometry = new Map<string, { top: number }>();
  const taskGeometry = new Map<string, { x: number; y: number }>();
  const rowOrigin = stageWidth > 0 ? Math.min(14, stageWidth / 2) : 14;
  let top = 0;
  for (const group of groups) {
    groupGeometry.set(group.id, { top });
    group.tasks.forEach((task, index) => {
      taskGeometry.set(task.id, {
        x: rowOrigin,
        y: top + 63 + index * 30 + 15
      });
    });
    top += 78 + group.tasks.length * 30 + 26;
  }
  return {
    groups: groupGeometry,
    tasks: taskGeometry,
    height: Math.max(380, top - 26)
  };
}

export function matrixFigurePoint(task: Task, today: string, stageWidth = 520) {
  const days = daysUntilTaskDeadline(task, today);
  const plotWidth = Math.min(520, stageWidth || 520);
  const x =
    20 +
    (1 - Math.min(7, Math.max(0, days)) / 7) *
      Math.max(0, plotWidth - 40);
  const importance = Math.min(5, Math.max(1, task.importanceScore));
  const y = 20 + ((5 - importance) / 4) * 300;
  return { x, y };
}

export function daysUntilTaskDeadline(task: Task, today: string) {
  if (!task.deadline) return 7;
  return Math.max(
    0,
    Math.ceil(
      (startOfDay(new Date(task.deadline)) - startOfDay(new Date(today))) / 86400000
    )
  );
}

export function matrixProjectColor(projectId: string | null) {
  const palette = ["#4f76a8", "#96667c", "#8a6a3c", "#777066"];
  if (!projectId) return palette[3];
  let hash = 0;
  for (const character of projectId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function matrixProjectName(
  task: Task,
  projects: Map<string, ProjectSummary>
) {
  return task.projectId ? projects.get(task.projectId)?.name ?? "Project" : "Standalone";
}

export function coordinateToScore(value: number) {
  return Math.min(5, Math.max(1, Math.round(value * 4 + 1)));
}

export function scoreToCoordinate(score: number) {
  return ((Math.min(5, Math.max(1, score)) - 1) / 4) * 86 + 7;
}

export function effectiveUrgentScore(task: Task, today: string) {
  if (!task.deadline) return task.urgentScore;
  const days = Math.ceil(
    (startOfDay(new Date(task.deadline)) - startOfDay(new Date(today))) / 86400000
  );
  const deadlineScore =
    days <= 1 ? 5 : days <= 3 ? 4 : days <= 7 ? 3 : days <= 14 ? 2 : 1;
  return Math.max(task.urgentScore, deadlineScore);
}

export function startOfDay(value: Date) {
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

export function formatBacklogDue(value: string | null, today: string) {
  if (!value) return "—";
  const days = Math.ceil(
    (startOfDay(new Date(value)) - startOfDay(new Date(today))) / 86400000
  );
  if (days <= 0) return "Today";
  return formatShortDate(value);
}

export function isTaskResponse(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.focusQueuePosition === null ||
      Number.isInteger(task.focusQueuePosition)) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

export function isFocusQueueResponse(
  value: unknown
): value is { tasks: Task[] } {
  if (!value || typeof value !== "object") return false;
  const result = value as { tasks?: unknown };
  return Array.isArray(result.tasks) && result.tasks.every(isTaskResponse);
}

export function isTaskReorderResponse(
  value: unknown
): value is { ok: true; tasks: Task[] } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    isFocusQueueResponse(value)
  );
}
