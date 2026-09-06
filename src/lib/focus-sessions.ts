import { sameDayRange } from "@/lib/dates";
import { appErrorConstructor } from "@/lib/error-compat";
import { suggestedBreakMinutes } from "@/lib/focus-domain";
import { focusErrors } from "@/lib/focus-errors";
import { consumeFocusQueueTask } from "@/lib/focus-queue";
import { prisma } from "@/lib/prisma";
import { AppError, validation } from "@/shared/kernel/errors";
import {
  FocusSessionKind,
  FocusSessionStatus,
  Prisma
} from "@prisma/client";

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

export async function getFocusSnapshot(
  database: Prisma.TransactionClient | typeof prisma,
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

export async function startFocusSession(
  input: {
    kind?: string;
    plannedMinutes: number;
    label?: string;
    taskId?: string | null;
    projectId?: string | null;
  },
  transaction: Prisma.TransactionClient
) {
  const kind = parseKind(input.kind);
  const plannedMinutes = Number(input.plannedMinutes);
  if (
    !Number.isInteger(plannedMinutes) ||
    plannedMinutes < 1 ||
    plannedMinutes > 240
  ) {
    throw new AppError(focusErrors.timerDurationMustBeBetween1And240Minutes);
  }

  const database = transaction;
  const active = await database.focusSession.findFirst({
    where: { status: { in: ["RUNNING", "PAUSED"] } },
    select: { id: true }
  });
  if (active) {
    throw new AppError(focusErrors.finishOrCancelTheActiveTimerFirst);
  }

  if (kind === "BREAK") {
    return createWithActiveSessionGuard(() =>
      database.focusSession.create({
        data: {
          activeKey: 1,
          kind,
          plannedMinutes,
          label: "Break"
        },
        include: focusSessionInclude
      })
    );
  }

  const taskId = String(input.taskId ?? "").trim() || null;
  const requestedProjectId = String(input.projectId ?? "").trim() || null;

  const createSession = async (sessionTransaction: Prisma.TransactionClient) => {
    const task = taskId
      ? await sessionTransaction.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          projectId: true
        }
      })
      : null;
    if (taskId && !task) {
      throw new AppError(focusErrors.theSelectedTaskCouldNotBeFound);
    }

    let projectId = requestedProjectId;
    let projectName = "";
    if (task?.projectId) {
      if (projectId && projectId !== task.projectId) {
        throw new AppError(focusErrors.theSelectedTaskBelongsToADifferentProject);
      }
      projectId = null;
    } else if (projectId) {
      const project = await sessionTransaction.project.findUnique({
        where: { id: projectId },
        select: { name: true }
      });
      if (!project) {
        throw new AppError(focusErrors.theSelectedProjectCouldNotBeFound);
      }
      projectName = project.name;
    }

    const label =
      String(input.label ?? "").trim() ||
      task?.title ||
      projectName ||
      "Focus session";
    const session = await sessionTransaction.focusSession.create({
      data: {
        activeKey: 1,
        kind,
        plannedMinutes,
        label,
        taskId,
        projectId
      },
      include: focusSessionInclude
    });
    if (taskId) await consumeFocusQueueTask(sessionTransaction, taskId);
    return session;
  };

  return createWithActiveSessionGuard(() =>
    transaction
      ? createSession(transaction)
      : prisma.$transaction(createSession)
  );
}

export async function transitionFocusSession(
  id: string,
  action: string,
  input: {
    note?: unknown;
    category?: unknown;
    taskCompleted?: unknown;
  } = {},
  now: Date
) {
  const session = await prisma.focusSession.findUnique({
    where: { id },
    include: focusSessionInclude
  });
  if (!session) {
    throw new AppError(focusErrors.focusSessionNotFound);
  }

  if (action === "pause") {
    if (session.status !== "RUNNING") {
      throw new AppError(focusErrors.onlyARunningTimerCanBePaused);
    }
    const paused = await prisma.focusSession.updateMany({
      where: { id, status: "RUNNING", activeKey: 1 },
      data: { status: "PAUSED", pausedAt: now }
    });
    if (paused.count !== 1) throw terminalTransitionConflict();
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "resume") {
    if (session.status !== "PAUSED" || !session.pausedAt) {
      throw new AppError(focusErrors.onlyAPausedTimerCanBeResumed);
    }
    const pausedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000)
    );
    const resumed = await prisma.focusSession.updateMany({
      where: { id, status: "PAUSED", activeKey: 1 },
      data: {
        status: "RUNNING",
        pausedAt: null,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds + pausedSeconds
      }
    });
    if (resumed.count !== 1) throw terminalTransitionConflict();
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "cancel") {
    if (!isActive(session.status)) {
      throw new AppError(focusErrors.thisTimerIsNoLongerActive);
    }
    const canceled = await prisma.focusSession.updateMany({
      where: {
        id,
        status: session.status,
        activeKey: 1
      },
      data: {
        activeKey: null,
        status: "CANCELED",
        completedAt: now,
        pausedAt: null
      }
    });
    if (canceled.count !== 1) throw terminalTransitionConflict();
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "enrich" || action === "record") {
    if (session.kind !== "FOCUS" || session.status !== "COMPLETED") {
      throw new AppError(focusErrors.onlyACompletedFocusBlockCanBeEnriched);
    }
    const note = String(input.note ?? "").trim();
    const category = String(input.category ?? "").trim() || "Deep Work";
    const activityNote =
      note || session.task?.title || session.label || "Focus session";

    const activity = await prisma.$transaction(async (transaction) => {
      let persistedActivity = null;
      if (session.actualMinutes >= 1) {
        persistedActivity = await transaction.activityEntry.upsert({
          where: { focusSessionId: session.id },
          create: {
            startedAt: session.startedAt,
            durationMinutes: session.actualMinutes,
            category,
            note: activityNote,
            origin: "FOCUS",
            taskId: session.taskId,
            projectId: session.task?.projectId ? null : session.projectId,
            attributedProjectId: session.task?.projectId ?? session.projectId,
            focusSessionId: session.id
          },
          update: {
            category,
            note: activityNote
          }
        });
      }
      if (input.taskCompleted === true && session.taskId) {
        await transaction.task.updateMany({
          where: {
            id: session.taskId,
            status: { not: "DONE" }
          },
          data: {
            status: "DONE",
            completedAt: now
          }
        });
        await consumeFocusQueueTask(transaction, session.taskId);
      }
      await transaction.focusSession.updateMany({
        where: { id, enrichedAt: null },
        data: { enrichedAt: now }
      });
      await transaction.focusSession.update({
        where: { id },
        data: {
          needsEnrichment: false,
          completionNote: note || null,
          completionCategory: category
        }
      });
      return persistedActivity;
    });

    return {
      completed: true,
      enriched: true,
      activity,
      suggestedBreakMinutes: suggestedBreakMinutes(session.plannedMinutes),
      completedSession: null
    };
  }

  if (action === "complete") {
    if (session.status === "COMPLETED") {
      return {
        completed: true,
        suggestedBreakMinutes:
          session.kind === "FOCUS" ? suggestedBreakMinutes(session.plannedMinutes) : null,
        completedSession: session.kind === "FOCUS" ? session : null
      };
    }
    if (!isActive(session.status)) {
      throw new AppError(focusErrors.thisTimerIsNoLongerActive);
    }

    const effectiveEnd = session.status === "PAUSED" && session.pausedAt ? session.pausedAt : now;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((effectiveEnd.getTime() - session.startedAt.getTime()) / 1000) -
      session.accumulatedPauseSeconds
    );
    const actualMinutes = Math.min(
      session.plannedMinutes,
      Math.floor(elapsedSeconds / 60)
    );

    const completedSession = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.focusSession.updateMany({
        where: {
          id,
          status: session.status,
          activeKey: 1
        },
        data: {
          activeKey: null,
          status: "COMPLETED",
          completedAt: now,
          pausedAt: null,
          actualMinutes,
          needsEnrichment: session.kind === "FOCUS"
        }
      });
      if (claimed.count !== 1) {
        const persisted = await transaction.focusSession.findUnique({
          where: { id },
          include: focusSessionInclude
        });
        if (persisted?.status === "COMPLETED") return persisted;
        throw terminalTransitionConflict();
      }
      if (session.kind === "FOCUS" && actualMinutes >= 1) {
        await transaction.activityEntry.upsert({
          where: { focusSessionId: session.id },
          create: {
            startedAt: session.startedAt,
            durationMinutes: actualMinutes,
            category: "Deep Work",
            note: session.task?.title || session.label || "Focus session",
            origin: "FOCUS",
            taskId: session.taskId,
            projectId: session.task?.projectId ? null : session.projectId,
            attributedProjectId: session.task?.projectId ?? session.projectId,
            focusSessionId: session.id
          },
          update: {}
        });
      }
      return transaction.focusSession.findUniqueOrThrow({
        where: { id },
        include: focusSessionInclude
      });
    });

    return {
      completed: true,
      suggestedBreakMinutes:
        session.kind === "FOCUS" ? suggestedBreakMinutes(session.plannedMinutes) : null,
      completedSession: session.kind === "FOCUS" ? completedSession : null
    };
  }

  throw new AppError(focusErrors.unknownTimerAction);
}

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const FocusSessionError = appErrorConstructor(
  (
    message: string
  ) => validation(message)
);
export type FocusSessionError = AppError;
/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as FocusSessionConflictError };

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as FocusSessionNotFoundError };

function parseKind(value: unknown): FocusSessionKind {
  const kind = String(value ?? "FOCUS").trim().toUpperCase();
  if (kind === "FOCUS" || kind === "BREAK") return kind;
  throw new AppError(focusErrors.timerKindMustBeFOCUSOrBREAK);
}

function isActive(status: FocusSessionStatus) {
  return status === "RUNNING" || status === "PAUSED";
}

function terminalTransitionConflict() {
  return new AppError(focusErrors.thisTimerWasUpdatedInAnotherTabRefreshAndTryAgain);
}

async function createWithActiveSessionGuard<T>(
  create: () => Promise<T>
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(focusErrors.finishOrCancelTheActiveTimerFirst);
    }
    throw error;
  }
}
