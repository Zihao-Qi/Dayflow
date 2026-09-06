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

/** Completion preserves existing evidence; enrichment changes only category/note. */
export function recordFocusActivity(
  tx: Prisma.TransactionClient,
  evidence: FocusActivityEvidence,
  enrichment?: { category: string; note: string }
) {
  return tx.activityEntry.upsert({
    where: { focusSessionId: evidence.id },
    create: {
      startedAt: evidence.startedAt,
      durationMinutes: evidence.actualMinutes,
      category: enrichment ? enrichment.category : "Deep Work",
      note: enrichment ? enrichment.note : evidence.task?.title || evidence.label || "Focus session",
      origin: "FOCUS",
      taskId: evidence.taskId,
      projectId: evidence.task?.projectId ? null : evidence.projectId,
      attributedProjectId: evidence.task?.projectId ?? evidence.projectId,
      focusSessionId: evidence.id
    },
    update: enrichment ? { category: enrichment.category, note: enrichment.note } : {}
  });
}
