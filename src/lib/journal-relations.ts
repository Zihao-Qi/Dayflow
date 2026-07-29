import type { Prisma } from "@prisma/client";
import {
  JournalRequestError,
  type MaterialCreateInput,
  type NoteCreateInput
} from "@/lib/journal-domain";

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
    throw new JournalRequestError(
      "RELATIONSHIP_NOT_FOUND",
      "The linked task could not be found.",
      404
    );
  }

  const project = input.projectId
    ? await transaction.project.findUnique({
        where: { id: input.projectId },
        select: { id: true }
      })
    : null;
  if (input.projectId && !project) {
    throw new JournalRequestError(
      "RELATIONSHIP_NOT_FOUND",
      "The linked project could not be found.",
      404
    );
  }

  if (
    task?.projectId &&
    input.projectId &&
    input.projectId !== task.projectId
  ) {
    throw new JournalRequestError(
      "ATTRIBUTION_CONFLICT",
      "The selected task belongs to a different project.",
      409
    );
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
    throw new JournalRequestError(
      "RELATIONSHIP_NOT_FOUND",
      "The linked note could not be found.",
      404
    );
  }

  const noteProjectId = note.task?.projectId ?? note.projectId;
  if (
    noteProjectId &&
    attribution.effectiveProjectId &&
    noteProjectId !== attribution.effectiveProjectId
  ) {
    throw new JournalRequestError(
      "ATTRIBUTION_CONFLICT",
      "The selected note belongs to a different project.",
      409
    );
  }

  return { ...attribution, noteId: note.id };
}
