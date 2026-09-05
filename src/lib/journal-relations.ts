import {
  type MaterialCreateInput,
  type NoteCreateInput
} from "@/lib/journal-domain";
import { journalErrors } from "@/lib/journal-errors";
import { AppError } from "@/shared/kernel/errors";
import type { Prisma } from "@prisma/client";

type JournalAttributionInput = Pick<NoteCreateInput, "taskId" | "projectId">;

export type JournalAttribution = {
  taskId: string | null;
  projectId: string | null;
  effectiveProjectId: string | null;
};

export async function resolveJournalAttribution(
  transaction: Prisma.TransactionClient,
  input: JournalAttributionInput
): Promise<JournalAttribution> {
  const task = input.taskId
    ? await transaction.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, projectId: true }
    })
    : null;
  if (input.taskId && !task) {
    throw new AppError(journalErrors.theLinkedTaskCouldNotBeFound);
  }

  const project = input.projectId
    ? await transaction.project.findUnique({
      where: { id: input.projectId },
      select: { id: true }
    })
    : null;
  if (input.projectId && !project) {
    throw new AppError(journalErrors.theLinkedProjectCouldNotBeFound);
  }

  if (
    task?.projectId &&
    input.projectId &&
    input.projectId !== task.projectId
  ) {
    throw new AppError(journalErrors.theSelectedTaskBelongsToADifferentProject);
  }

  const projectId = task?.projectId ? null : input.projectId;

  return {
    taskId: input.taskId,
    projectId,
    effectiveProjectId: task?.projectId ?? projectId
  };
}

export async function resolveMaterialRelations(
  transaction: Prisma.TransactionClient,
  input: MaterialCreateInput
) {
  const attribution = await resolveJournalAttribution(transaction, input);
  if (!input.noteId) {
    return { ...attribution, noteId: null };
  }

  const note = await transaction.note.findUnique({
    where: { id: input.noteId },
    select: {
      id: true,
      projectId: true,
      task: { select: { projectId: true } }
    }
  });
  if (!note) {
    throw new AppError(journalErrors.theLinkedNoteCouldNotBeFound);
  }

  const noteProjectId = note.task?.projectId ?? note.projectId;
  if (
    noteProjectId &&
    attribution.effectiveProjectId &&
    noteProjectId !== attribution.effectiveProjectId
  ) {
    throw new AppError(journalErrors.theSelectedNoteBelongsToADifferentProject);
  }

  return { ...attribution, noteId: note.id };
}
