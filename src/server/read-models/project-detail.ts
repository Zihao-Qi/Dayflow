import { readProjectActivities } from "@/modules/evidence/services/activities";
import type { Prisma } from "@prisma/client";
import { summarizeProject } from "@/modules/projects/domain/project";
import { readProject } from "@/modules/projects/services/projects";
import { readProjectTasks } from "@/modules/planning/services/tasks";

type DetailDatabase = {
  project: Pick<Prisma.TransactionClient["project"], "findUnique">;
  task: Pick<Prisma.TransactionClient["task"], "findMany">;
  activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "findMany">;
  note: Pick<Prisma.TransactionClient["note"], "findMany">;
  material: Pick<Prisma.TransactionClient["material"], "findMany">;
};

/** Caller owns the transaction; evidence and journal reads stay here until their slices exist. */
export async function getProjectDetail(database: DetailDatabase, id: string, reviewPeriod: { start: Date; end: Date }) {
  const project = await readProject(database, id);
  if (!project) return null;
  const tasks = await readProjectTasks(database, [id]);
  const taskIds = tasks.map(task => task.id);
  const where = { OR: [{ projectId: id }, { taskId: { in: taskIds } }] };
  const [activities, notes, materials] = await Promise.all([
    readProjectActivities(database, id),
    database.note.findMany({ where, orderBy: { createdAt: "desc" } }),
    database.material.findMany({ where, orderBy: { createdAt: "desc" } })
  ]);
  // Legacy order: direct journal rows first, then rows for each task in task order.
  // Map replacement deduplicates a row linked both directly and through a task.
  function journalOrder<T extends { id: string; projectId: string | null; taskId: string | null }>(rows: T[]) {
    const directRows: T[] = [];
    const rowsByTask = new Map<string, T[]>();
    for (const row of rows) {
      if (row.projectId === id) directRows.push(row);
      const taskId = row.taskId;
      if (taskId !== null) {
        const bucket = rowsByTask.get(taskId);
        if (bucket) bucket.push(row);
        else rowsByTask.set(taskId, [row]);
      }
    }
    const ordered = new Map(directRows.map(row => [row.id, row]));
    for (const task of tasks) {
      for (const row of rowsByTask.get(task.id) ?? []) ordered.set(row.id, row);
    }
    return [...ordered.values()];
  }
  return {
    ...summarizeProject({ ...project, tasks, attributedActivities: activities }, reviewPeriod),
    phases: project.phases,
    tasks,
    activities,
    notes: journalOrder(notes).map(note => ({ ...note, tags: safeTags(note.tags) })),
    materials: journalOrder(materials)
  };
}

function safeTags(tags: string) {
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
