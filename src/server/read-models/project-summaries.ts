import { readProjectActivitySummaries } from "@/modules/evidence/services/activities";
import type { Prisma } from "@prisma/client";
import { summarizeProjects } from "@/modules/projects/domain/project";
import { readProjects } from "@/modules/projects/services/projects";
import { readProjectTasks } from "@/modules/planning/services/tasks";

type SummaryDatabase = {
  project: Pick<Prisma.TransactionClient["project"], "findMany">;
  task: Pick<Prisma.TransactionClient["task"], "findMany">;
  activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "findMany">;
};

/** Compose inside the caller's read transaction. */
export async function listProjectSummaries(database: SummaryDatabase, reviewPeriod: { start: Date; end: Date }) {
  const projects = await readProjects(database);
  if (!projects.length) return [];
  const ids = projects.map(project => project.id);
  const [tasks, activities] = await Promise.all([
    readProjectTasks(database, ids),
    readProjectActivitySummaries(database, ids)
  ]);
  return summarizeProjects(projects, tasks, activities, reviewPeriod);
}
