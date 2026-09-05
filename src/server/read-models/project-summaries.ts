import type { Prisma } from "@prisma/client";
import { summarizeProject } from "@/modules/projects/domain/project";
import { readProjects } from "@/modules/projects/services/projects";
import { readProjectTasks } from "@/modules/planning/services/tasks";

type SummaryDatabase = {
  project: Pick<Prisma.TransactionClient["project"], "findMany">;
  task: Pick<Prisma.TransactionClient["task"], "findMany">;
  activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "findMany">;
};

/** Compose inside the caller's read transaction. Evidence has no service yet. */
export async function listProjectSummaries(database: SummaryDatabase, reviewPeriod: { start: Date; end: Date }) {
  const projects = await readProjects(database);
  if (!projects.length) return [];
  const ids = projects.map(project => project.id);
  const [tasks, activities] = await Promise.all([
    readProjectTasks(database, ids),
    database.activityEntry.findMany({
      where: { attributedProjectId: { in: ids } },
      select: { id: true, attributedProjectId: true, durationMinutes: true, startedAt: true }
    })
  ]);
  const tasksByProject = new Map<string | null, typeof tasks>();
  for (const task of tasks) {
    const projectId = task.projectId;
    const bucket = tasksByProject.get(projectId);
    if (bucket) bucket.push(task);
    else tasksByProject.set(projectId, [task]);
  }
  const activitiesByProject = new Map<string | null, typeof activities>();
  for (const activity of activities) {
    const projectId = activity.attributedProjectId;
    const bucket = activitiesByProject.get(projectId);
    if (bucket) bucket.push(activity);
    else activitiesByProject.set(projectId, [activity]);
  }
  return projects.map(project => summarizeProject({
    ...project,
    tasks: tasksByProject.get(project.id) ?? [],
    attributedActivities: activitiesByProject.get(project.id) ?? []
  }, reviewPeriod));
}
