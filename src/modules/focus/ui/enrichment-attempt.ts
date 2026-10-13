export type FocusEnrichmentInput = {
  note: string;
  category: string;
  taskCompleted: boolean;
};

export type FocusEnrichmentAttempt = {
  sessionId: string;
  mutationId: string;
  fingerprint: string;
  payload: FocusEnrichmentInput;
};

/** The next-session choice is a separate write, not part of enrichment intent. */
export function prepareFocusEnrichmentAttempt(
  previous: FocusEnrichmentAttempt | null,
  sessionId: string,
  input: FocusEnrichmentInput,
  createMutationId = () => `focus-enrich-${crypto.randomUUID()}`
): FocusEnrichmentAttempt {
  const payload = {
    note: input.note.trim(),
    category: input.category.trim() || "Deep Work",
    taskCompleted: input.taskCompleted
  };
  const fingerprint = JSON.stringify({ sessionId, ...payload });
  if (previous?.fingerprint === fingerprint) return previous;
  return { sessionId, mutationId: createMutationId(), fingerprint, payload };
}
