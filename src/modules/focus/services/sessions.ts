import type { Prisma } from "@prisma/client";
import { sameDayRange } from "@/shared/kernel/calendar";
import { AppError } from "@/shared/kernel/errors";
import { readFocusTask, completeFocusTask } from "@/modules/planning/services/tasks";
import { consumeFocusQueueTask } from "@/modules/planning/services/focus-queue";
import { readProjectName } from "@/modules/projects/services/projects";
import { recordFocusActivity, enrichFocusActivity } from "@/modules/evidence/services/focus-activity";
import { focusErrors, parseKind, transition, suggestedBreakMinutes,
  type StartSessionInput, type EnrichmentDetails } from "../domain/session";

type SnapshotDatabase = {
  focusSession: Pick<Prisma.TransactionClient["focusSession"], "findFirst" | "findMany">;
  activityEntry: Pick<Prisma.TransactionClient["activityEntry"], "aggregate">;
};

const focusSessionInclude = {
  task: {
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { id: true, name: true } },
      phase: { select: { id: true, name: true } }
    }
  },
  project: {
    select: { id: true, name: true }
  },
  activity: {
    select: { id: true }
  }
};

export async function readSnapshot(
  database: SnapshotDatabase,
  now: Date
) {
  const { start, end } = sameDayRange(now);
  const [active, pendingCompletion, completed, focused] = await Promise.all([
    database.focusSession.findFirst({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      orderBy: { startedAt: "desc" },
      include: focusSessionInclude
    }),
    database.focusSession.findFirst({
      where: {
        kind: "FOCUS",
        status: "COMPLETED",
        needsEnrichment: true
      },
      orderBy: { completedAt: "desc" },
      include: focusSessionInclude
    }),
    database.focusSession.findMany({
      where: {
        kind: "FOCUS",
        status: "COMPLETED",
        completedAt: { gte: start, lt: end }
      },
      select: { actualMinutes: true }
    }),
    database.activityEntry.aggregate({
      where: {
        origin: "FOCUS",
        startedAt: { gte: start, lt: end }
      },
      _sum: { durationMinutes: true }
    })
  ]);

  return {
    active,
    pendingCompletion,
    today: {
      completedSessions: completed.length,
      focusedMinutes: focused._sum.durationMinutes ?? 0
    }
  };
}

export async function startSession(tx: Prisma.TransactionClient, input: StartSessionInput, now: Date) {
  try {
    const kind = parseKind(input.kind);
    const plannedMinutes = Number(input.plannedMinutes);
    if (!Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 240) {
      throw new AppError(focusErrors.timerDurationMustBeBetween1And240Minutes);
    }
    const active = await tx.focusSession.findFirst({
      where: { status: { in: ["RUNNING", "PAUSED"] } }, select: { id: true }
    });
    if (active) throw new AppError(focusErrors.finishOrCancelTheActiveTimerFirst);
    if (kind === "BREAK") {
      return await createWithActiveSessionGuard(() => tx.focusSession.create({
        data: { activeKey: 1, kind, plannedMinutes, label: "Break", startedAt: now }, include: focusSessionInclude
      }));
    }
    const taskId = String(input.taskId ?? "").trim() || null;
    let projectId = String(input.projectId ?? "").trim() || null;
    const task = taskId ? await readFocusTask(tx, taskId) : null;
    if (taskId && !task) throw new AppError(focusErrors.theSelectedTaskCouldNotBeFound);
    let projectName = "";
    if (task?.projectId) {
      if (projectId && projectId !== task.projectId) throw new AppError(focusErrors.theSelectedTaskBelongsToADifferentProject);
      projectId = null;
    } else if (projectId) {
      const project = await readProjectName(tx, projectId);
      if (!project) throw new AppError(focusErrors.theSelectedProjectCouldNotBeFound);
      projectName = project.name;
    }
    const label = String(input.label ?? "").trim() || task?.title || projectName || "Focus session";
    // Preserve the original guard's scope, including queue consumption failures.
    return await createWithActiveSessionGuard(async () => {
      const session = await tx.focusSession.create({
        data: { activeKey: 1, kind, plannedMinutes, label, taskId, projectId, startedAt: now }, include: focusSessionInclude
      });
      if (taskId) await consumeFocusQueueTask(tx, taskId);
      return session;
    });
  } catch (error) { throw translateFocusPersistenceError(error, "start"); }
}

export async function transitionSession(tx: Prisma.TransactionClient, id: string, action: string, now: Date) {
  try {
    const session = await tx.focusSession.findUnique({ where: { id }, include: focusSessionInclude });
    if (!session) throw new AppError(focusErrors.focusSessionNotFound);
    const next = transition(session, action, now);
    if (action === "complete" && session.status === "COMPLETED") return completionResult(session);
    const { activeKey, status, completedAt, pausedAt, accumulatedPauseSeconds, actualMinutes, needsEnrichment } = next.state;
    const claimed = await tx.focusSession.updateMany({
      where: { id, status: session.status, activeKey: 1 },
      data: { activeKey, status, completedAt, pausedAt, accumulatedPauseSeconds, actualMinutes, needsEnrichment }
    });
    if (claimed.count !== 1) {
      if (action === "complete") {
        const persisted = await tx.focusSession.findUnique({ where: { id }, include: focusSessionInclude });
        if (persisted?.status === "COMPLETED") return completionResult(persisted);
      }
      throw new AppError(focusErrors.thisTimerWasUpdatedInAnotherTabRefreshAndTryAgain);
    }
    if (action !== "complete") return { completed: false, suggestedBreakMinutes: null };
    if (next.evidence) await recordFocusActivity(tx, next.evidence);
    return completionResult(await tx.focusSession.findUniqueOrThrow({ where: { id }, include: focusSessionInclude }));
  } catch (error) { throw translateFocusPersistenceError(error, "save"); }
}

export async function enrichSession(tx: Prisma.TransactionClient, id: string, details: EnrichmentDetails, now: Date) {
  try {
    const session = await tx.focusSession.findUnique({ where: { id }, include: focusSessionInclude });
    if (!session) throw new AppError(focusErrors.focusSessionNotFound);
    if (session.kind !== "FOCUS" || session.status !== "COMPLETED") throw new AppError(focusErrors.onlyACompletedFocusBlockCanBeEnriched);
    const note = String(details.note ?? "").trim();
    const category = String(details.category ?? "").trim() || "Deep Work";
    const activityNote = note || session.task?.title || session.label || "Focus session";
    const activity = session.actualMinutes >= 1 ? await enrichFocusActivity(tx, session.id, {
      ...session, category, note: activityNote
    }) : null;
    if (details.taskCompleted === true && session.taskId) {
      await completeFocusTask(tx, session.taskId, now);
      await consumeFocusQueueTask(tx, session.taskId);
    }
    await tx.focusSession.updateMany({ where: { id, enrichedAt: null }, data: { enrichedAt: now } });
    await tx.focusSession.update({ where: { id }, data: {
      needsEnrichment: false, completionNote: note || null, completionCategory: category
    } });
    return { completed: true, enriched: true, activity,
      suggestedBreakMinutes: suggestedBreakMinutes(session.plannedMinutes), completedSession: null };
  } catch (error) { throw translateFocusPersistenceError(error, "save"); }
}

function completionResult<T extends { kind: string; plannedMinutes: number }>(session: T) {
  return { completed: true,
    suggestedBreakMinutes: session.kind === "FOCUS" ? suggestedBreakMinutes(session.plannedMinutes) : null,
    completedSession: session.kind === "FOCUS" ? session : null };
}

function isKnownRequestError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && error.name === "PrismaClientKnownRequestError" &&
    "clientVersion" in error && typeof error.clientVersion === "string" && "code" in error && typeof error.code === "string";
}

async function createWithActiveSessionGuard<T>(create: () => Promise<T>): Promise<T> {
  try { return await create(); }
  catch (error) {
    if (isKnownRequestError(error) && error.code === "P2002") throw new AppError(focusErrors.finishOrCancelTheActiveTimerFirst, error);
    throw error;
  }
}

/** Commit/receipt failures use the same translation, without swallowing receipt P2002. */
export function translateFocusPersistenceError(error: unknown, action: "start" | "save"): unknown {
  if (isKnownRequestError(error)) {
    if (action === "start" && error.code === "P2003") return new AppError(focusErrors.aSelectedFocusRelationshipChangedBeforeTheTimerStarted, error);
    if (action === "save" && (error.code === "P2003" || error.code === "P2025")) return new AppError(focusErrors.theFocusSessionChangedBeforeItCouldBeSaved, error);
  }
  return error;
}
