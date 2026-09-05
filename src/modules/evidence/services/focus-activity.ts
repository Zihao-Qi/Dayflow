import type { Prisma } from "@prisma/client";

/** Caller supplies its session snapshot and elapsed minutes in the same transaction.
 * Focus owns eligibility and enrichment text defaults; this writer supplies completion text defaults.
 */
export type FocusActivityEvidence = {
  id: string;
  startedAt: Date;
  actualMinutes: number;
  taskId: string | null;
  projectId: string | null;
  task: { title: string; projectId: string | null } | null;
  label: string | null;
};

export function recordFocusActivity(tx: Prisma.TransactionClient, evidence: FocusActivityEvidence) {
  return tx.activityEntry.upsert({
    where: { focusSessionId: evidence.id },
    create: {
      startedAt: evidence.startedAt,
      durationMinutes: evidence.actualMinutes,
      category: "Deep Work",
      note: evidence.task?.title || evidence.label || "Focus session",
      origin: "FOCUS",
      taskId: evidence.taskId,
      projectId: evidence.task?.projectId ? null : evidence.projectId,
      attributedProjectId: evidence.task?.projectId ?? evidence.projectId,
      focusSessionId: evidence.id
    },
    update: {}
  });
}

/** Enrichment can create missing evidence; existing rows change only category/note. */
export function enrichFocusActivity(
  tx: Prisma.TransactionClient,
  sessionId: string,
  details: Omit<FocusActivityEvidence, "id" | "label"> & { category: string; note: string }
) {
  return tx.activityEntry.upsert({
    where: { focusSessionId: sessionId },
    create: {
      startedAt: details.startedAt,
      durationMinutes: details.actualMinutes,
      category: details.category,
      note: details.note,
      origin: "FOCUS",
      taskId: details.taskId,
      projectId: details.task?.projectId ? null : details.projectId,
      attributedProjectId: details.task?.projectId ?? details.projectId,
      focusSessionId: sessionId
    },
    update: { category: details.category, note: details.note }
  });
}
