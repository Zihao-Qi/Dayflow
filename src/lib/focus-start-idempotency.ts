export type FocusStartPayload = {
  kind: "FOCUS" | "BREAK";
  plannedMinutes: number;
  label?: string;
  taskId: string | null;
  projectId: string | null;
};

export type FocusStartAttempt = {
  mutationId: string;
  fingerprint: string;
  payload: FocusStartPayload;
};

type FocusStartInput = {
  kind?: "FOCUS" | "BREAK";
  plannedMinutes: number;
  label?: string;
  taskId?: string | null;
  projectId?: string | null;
};

export function prepareFocusStartAttempt(
  previous: FocusStartAttempt | null,
  input: FocusStartInput,
  createMutationId = createFocusStartMutationId
): FocusStartAttempt {
  const label = input.label?.trim();
  const payload: FocusStartPayload = {
    kind: input.kind ?? "FOCUS",
    plannedMinutes: Math.round(Number(input.plannedMinutes)),
    ...(label ? { label } : {}),
    taskId: input.taskId?.trim() || null,
    projectId: input.projectId?.trim() || null
  };
  const fingerprint = JSON.stringify(payload);
  if (previous?.fingerprint === fingerprint) {
    return { ...previous, payload };
  }
  return {
    mutationId: createMutationId(),
    fingerprint,
    payload
  };
}

function createFocusStartMutationId() {
  return `focus-start-${crypto.randomUUID()}`;
}
