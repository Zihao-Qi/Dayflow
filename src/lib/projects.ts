import {
  Prisma,
  ProjectDurationUnit,
  ProjectStatus,
  TaskStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateProjectMetrics } from "@/lib/project-domain";
import { reviewPeriodRange } from "@/lib/dates";

const projectRead = {
  phases: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }]
  },
  tasks: {
    orderBy: [{ date: "asc" as const }, { sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      activities: {
        select: {
          id: true,
          startedAt: true,
          durationMinutes: true,
          category: true,
          note: true,
          taskId: true,
          projectId: true
        }
      },
      notes: {
        orderBy: { createdAt: "desc" as const }
      },
      materials: {
        orderBy: { createdAt: "desc" as const }
      }
    }
  },
  attributedActivities: {
    orderBy: { startedAt: "desc" as const }
  },
  notes: {
    orderBy: { createdAt: "desc" as const }
  },
  materials: {
    orderBy: { createdAt: "desc" as const }
  }
};

export async function listProjectSummaries(
  reviewPeriod = reviewPeriodRange()
) {
  const projects = await prisma.project.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      phases: {
        select: { id: true }
      },
      tasks: {
        orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          activities: {
            select: { id: true, durationMinutes: true, startedAt: true }
          }
        }
      },
      attributedActivities: {
        select: { id: true, durationMinutes: true, startedAt: true }
      }
    }
  });

  return projects.map((project) => summarizeProject(project, reviewPeriod));
}

export async function getProjectDetail(
  id: string,
  client: Pick<Prisma.TransactionClient, "project">
) {
  const reviewPeriod = reviewPeriodRange();
  const project = await client.project.findUnique({
    where: { id },
    include: projectRead
  });

  if (!project) return null;

  const summary = summarizeProject(project, reviewPeriod);
  const activities = [...project.attributedActivities].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  );
  const notes = uniqueById([
    ...project.notes,
    ...project.tasks.flatMap((task) => task.notes)
  ]);
  const materials = uniqueById([
    ...project.materials,
    ...project.tasks.flatMap((task) => task.materials)
  ]);

  return {
    ...summary,
    phases: project.phases,
    tasks: project.tasks.map(
      ({ activities: _activities, notes: _notes, materials: _materials, ...task }) => task
    ),
    activities,
    notes: notes.map((note) => ({ ...note, tags: safeTags(note.tags) })),
    materials
  };
}

export async function validateProjectPlacement(
  projectId: string | null,
  phaseId: string | null,
  options: { allowCompleted?: boolean } = {},
  client: Pick<Prisma.TransactionClient, "project" | "projectPhase">
) {
  if (!projectId && phaseId) {
    throw new ProjectRuleError("A task cannot have a phase without a project.");
  }

  if (!projectId) return;

  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true }
  });
  if (!project) throw new ProjectRuleError("The selected project could not be found.");
  if (project.status === "COMPLETED" && !options.allowCompleted) {
    throw new ProjectRuleError("Reopen the completed project before adding unfinished work.");
  }

  if (!phaseId) return;

  const phase = await client.projectPhase.findUnique({
    where: { id: phaseId },
    select: { projectId: true }
  });
  if (!phase) {
    throw new ProjectRuleError("The selected phase could not be found.");
  }
  if (phase.projectId !== projectId) {
    throw new ProjectRuleError("The selected phase does not belong to this project.");
  }
}

export async function deletePhaseSafely(id: string) {
  await prisma.$transaction(async (transaction) => {
    await transaction.task.updateMany({
      where: { phaseId: id },
      data: { phaseId: null }
    });
    await transaction.projectPhase.delete({ where: { id } });
  });
}

export async function deleteProjectSafely(id: string) {
  await prisma.$transaction(async (transaction) => {
    await transaction.task.updateMany({
      where: { projectId: id },
      data: { projectId: null, phaseId: null }
    });
    await transaction.activityEntry.updateMany({
      where: {
        OR: [{ projectId: id }, { attributedProjectId: id }]
      },
      data: { projectId: null, attributedProjectId: null }
    });
    await transaction.note.updateMany({
      where: { projectId: id },
      data: { projectId: null }
    });
    await transaction.material.updateMany({
      where: { projectId: id },
      data: { projectId: null }
    });
    await transaction.project.delete({ where: { id } });
  });
}

export function parseProjectStatus(value: unknown): ProjectStatus | null {
  const status = String(value ?? "").toUpperCase();
  return Object.values(ProjectStatus).includes(status as ProjectStatus)
    ? (status as ProjectStatus)
    : null;
}

export class ProjectRuleError extends Error {}

type SummaryInput = {
  id: string;
  name: string;
  desiredOutcome: string;
  targetDate: Date | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  phases: Array<{ id: string }>;
  tasks: Array<{
    id: string;
    title: string;
    date: Date | null;
    status: TaskStatus;
    estimateMinutes: number;
    completedAt: Date | null;
    activities: Array<{ id: string; durationMinutes: number; startedAt: Date }>;
  }>;
  attributedActivities: Array<{
    id: string;
    durationMinutes: number;
    startedAt: Date;
  }>;
};

function summarizeProject(
  project: SummaryInput,
  reviewPeriod: { start: Date; end: Date }
) {
  const metrics = calculateProjectMetrics(project.tasks);
  const activities = project.attributedActivities;
  const investedMinutes = activities.reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );
  const reviewPeriodInvestedMinutes = activities
    .filter(
      (activity) =>
        activity.startedAt >= reviewPeriod.start &&
        activity.startedAt < reviewPeriod.end
    )
    .reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const movedDuringReviewPeriod =
    reviewPeriodInvestedMinutes > 0 ||
    project.tasks.some(
      (task) =>
        task.completedAt &&
        task.completedAt >= reviewPeriod.start &&
        task.completedAt < reviewPeriod.end
    );
  const nextTask =
    project.tasks
      .filter((task) => task.status !== "DONE")
      .sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
      })[0] ?? null;
  const progressDates = [
    ...activities.map((activity) => activity.startedAt),
    ...project.tasks.flatMap((task) => (task.completedAt ? [task.completedAt] : []))
  ];
  const lastProgressAt = progressDates.length
    ? new Date(Math.max(...progressDates.map((date) => date.getTime())))
    : null;

  return {
    id: project.id,
    name: project.name,
    desiredOutcome: project.desiredOutcome,
    targetDate: project.targetDate,
    targetDurationValue: project.targetDurationValue,
    targetDurationUnit: project.targetDurationUnit,
    weeklyMinutesBudget: project.weeklyMinutesBudget,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...metrics,
    phaseCount: project.phases.length,
    backlogCount: project.tasks.filter((task) => !task.date && task.status !== "DONE").length,
    investedMinutes,
    reviewPeriodInvestedMinutes,
    movedDuringReviewPeriod,
    nextTaskId: nextTask?.id ?? null,
    nextTaskTitle: nextTask?.title ?? null,
    nextTaskEstimateMinutes: nextTask?.estimateMinutes ?? null,
    lastProgressAt
  };
}

function safeTags(tags: string) {
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
