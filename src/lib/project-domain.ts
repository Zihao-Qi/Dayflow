export const projectStatuses = ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectDurationUnit = "DAYS" | "WEEKS";

export type ProjectMetricTask = {
  status: string;
};

export type ProjectMetrics = {
  completedTaskCount: number;
  taskCount: number;
  progressPercent: number | null;
};

export type ProjectSummary = ProjectMetrics & {
  id: string;
  name: string;
  desiredOutcome: string;
  targetDate: string | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  phaseCount: number;
  backlogCount: number;
  investedMinutes: number;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
  nextTaskEstimateMinutes: number | null;
  lastProgressAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPhaseRecord = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskRecord = {
  id: string;
  title: string;
  date: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

export type ProjectActivityRecord = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
};

export type ProjectNoteRecord = {
  id: string;
  content: string;
  tags: string[];
  taskId: string | null;
  projectId: string | null;
  date: string;
  createdAt: string;
};

export type ProjectMaterialRecord = {
  id: string;
  title: string;
  url: string;
  type: string;
  notes: string;
  taskId: string | null;
  projectId: string | null;
  createdAt: string;
};

export type ProjectDetail = ProjectSummary & {
  phases: ProjectPhaseRecord[];
  tasks: ProjectTaskRecord[];
  activities: ProjectActivityRecord[];
  notes: ProjectNoteRecord[];
  materials: ProjectMaterialRecord[];
};

export function calculateProjectMetrics(tasks: ProjectMetricTask[]): ProjectMetrics {
  const taskCount = tasks.length;
  const completedTaskCount = tasks.filter((task) => task.status === "DONE").length;

  return {
    completedTaskCount,
    taskCount,
    progressPercent: taskCount ? Math.round((completedTaskCount / taskCount) * 100) : null
  };
}

export function formatInvestedMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function projectStatusLabel(status: ProjectStatus) {
  const labels: Record<ProjectStatus, string> = {
    ACTIVE: "Active",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    ARCHIVED: "Archived"
  };
  return labels[status];
}

export function formatProjectDuration(
  value: number | null,
  unit: ProjectDurationUnit | null
) {
  if (!value || !unit) return "";
  const label =
    unit === "DAYS"
      ? value === 1
        ? "day"
        : "days"
      : value === 1
        ? "week"
        : "weeks";
  return `${value} ${label}`;
}
