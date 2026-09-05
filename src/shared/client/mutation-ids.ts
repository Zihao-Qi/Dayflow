import type { MutableRefObject } from "react";

export type PendingMutation = { id: string; fingerprint: string };

export function mutationIdFor(
  reference: MutableRefObject<PendingMutation | null>,
  payload: unknown
) {
  const fingerprint = JSON.stringify(payload);
  if (reference.current?.fingerprint === fingerprint) {
    return reference.current.id;
  }
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `dayflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reference.current = { id, fingerprint };
  return id;
}
