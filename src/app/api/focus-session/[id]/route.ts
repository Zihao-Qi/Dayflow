import { clock } from "@/lib/time";
import { getPrisma } from "@/lib/prisma";
import { parseMutationId, runOnce } from "@/server/prisma/run-once";
import { readFocusActivity } from "@/server/evidence";
import { runInTransaction } from "@/server/prisma/client";
import { readWorkflowMutationBody } from "@/lib/workflow-mutations";
import { parseFocusSessionId, parseFocusSessionTransitionMutation } from "@/modules/focus/domain/session";
import { readSnapshot, transitionSession, enrichSession, focusErrorResponse } from "@/server/focus";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const now = clock.now();
  try {
    const routeParams = await params;
    const id = parseFocusSessionId(routeParams.id, "id");
    const body = await readWorkflowMutationBody(request);
    const input = parseFocusSessionTransitionMutation(body);
    if (input.action === "enrich" || input.action === "record") {
      const mutationId = parseMutationId(request.headers.get("X-Dayflow-Mutation-Id"));
      if (mutationId) {
        // Both action aliases describe the same intent. Session identity prevents
        // accidental reuse of an ID against a different completion handoff.
        const intent = { id, note: input.note?.trim() || "",
          category: input.category?.trim() || "Deep Work", taskCompleted: input.taskCompleted === true };
        const acknowledgment = await runOnce({
          mutationId, kind: "focus-session.enrich", payload: intent,
          create: async tx => {
            const result = await enrichSession(tx, id, intent, now);
            return { completed: result.completed, enriched: result.enriched,
              suggestedBreakMinutes: result.suggestedBreakMinutes, completedSession: result.completedSession };
          }
        });
        // Do not receipt mutable read models. If this read fails after commit,
        // the original ID still protects the client's next attempt from rewriting.
        const current = await runInTransaction(async tx => {
          const [activity, snapshot] = await Promise.all([
            readFocusActivity(tx, id), readSnapshot(tx, clock.now())
          ]);
          return { activity, snapshot };
        });
        return NextResponse.json({ ...acknowledgment, ...current });
      }
    }
    // Headerless callers retain the existing intentional-edit behavior.
    const result = await runInTransaction(tx => input.action === "enrich" || input.action === "record"
      ? enrichSession(tx, id, input, now)
      : transitionSession(tx, id, input.action, now));
    return NextResponse.json({ ...result, snapshot: await readSnapshot(getPrisma(), now) });
  } catch (error) { return focusErrorResponse(error, "save"); }
}
