import { FocusSessionKind, FocusSessionStatus } from "@prisma/client";
import { sameDayRange } from "@/lib/dates";
import { suggestedBreakMinutes } from "@/lib/focus-domain";
import { prisma } from "@/lib/prisma";

const focusSessionInclude = {
  task: {
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { id: true, name: true } }
    }
  },
  project: {
    select: { id: true, name: true }
  }
};

export async function getFocusSnapshot() {
  const { start, end } = sameDayRange();
  const [active, completed] = await Promise.all([
    prisma.focusSession.findFirst({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      orderBy: { startedAt: "desc" },
      include: focusSessionInclude
    }),
    prisma.focusSession.findMany({
      where: {
        kind: "FOCUS",
        status: "COMPLETED",
        completedAt: { gte: start, lt: end }
      },
      select: { actualMinutes: true }
    })
  ]);

  return {
    active,
    today: {
      completedSessions: completed.length,
      focusedMinutes: completed.reduce((sum, session) => sum + session.actualMinutes, 0)
    }
  };
}

export async function startFocusSession(input: {
  kind?: string;
  plannedMinutes: number;
  label?: string;
  taskId?: string | null;
  projectId?: string | null;
}) {
  const kind = parseKind(input.kind);
  const plannedMinutes = Math.round(Number(input.plannedMinutes));
  if (!Number.isFinite(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 240) {
    throw new FocusSessionError("Timer duration must be between 1 and 240 minutes.");
  }

  const active = await prisma.focusSession.findFirst({
    where: { status: { in: ["RUNNING", "PAUSED"] } },
    select: { id: true }
  });
  if (active) throw new FocusSessionConflictError("Finish or cancel the active timer first.");

  if (kind === "BREAK") {
    return prisma.focusSession.create({
      data: {
        kind,
        plannedMinutes,
        label: "Break"
      },
      include: focusSessionInclude
    });
  }

  const taskId = String(input.taskId ?? "").trim() || null;
  let projectId = String(input.projectId ?? "").trim() || null;
  const task = taskId
    ? await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true } }
        }
      })
    : null;
  if (taskId && !task) throw new FocusSessionError("The selected task could not be found.");

  if (task?.projectId) {
    if (projectId && projectId !== task.projectId) {
      throw new FocusSessionError("The selected task belongs to a different project.");
    }
    projectId = null;
  } else if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });
    if (!project) throw new FocusSessionError("The selected project could not be found.");
  }

  const label =
    String(input.label ?? "").trim() ||
    task?.title ||
    (projectId
      ? (
          await prisma.project.findUnique({
            where: { id: projectId },
            select: { name: true }
          })
        )?.name
      : "") ||
    "Focus session";

  return prisma.focusSession.create({
    data: {
      kind,
      plannedMinutes,
      label,
      taskId,
      projectId
    },
    include: focusSessionInclude
  });
}

export async function transitionFocusSession(id: string, action: string) {
  const now = new Date();
  const session = await prisma.focusSession.findUnique({
    where: { id },
    include: focusSessionInclude
  });
  if (!session) throw new FocusSessionError("Focus session not found.");

  if (action === "pause") {
    if (session.status !== "RUNNING") {
      throw new FocusSessionError("Only a running timer can be paused.");
    }
    await prisma.focusSession.update({
      where: { id },
      data: { status: "PAUSED", pausedAt: now }
    });
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "resume") {
    if (session.status !== "PAUSED" || !session.pausedAt) {
      throw new FocusSessionError("Only a paused timer can be resumed.");
    }
    const pausedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000)
    );
    await prisma.focusSession.update({
      where: { id },
      data: {
        status: "RUNNING",
        pausedAt: null,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds + pausedSeconds
      }
    });
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "cancel") {
    if (!isActive(session.status)) {
      throw new FocusSessionError("This timer is no longer active.");
    }
    await prisma.focusSession.update({
      where: { id },
      data: { status: "CANCELED", completedAt: now, pausedAt: null }
    });
    return { completed: false, suggestedBreakMinutes: null };
  }

  if (action === "complete") {
    if (!isActive(session.status)) {
      throw new FocusSessionError("This timer is no longer active.");
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

    await prisma.$transaction(async (transaction) => {
      if (session.kind === "FOCUS" && actualMinutes >= 1) {
        await transaction.activityEntry.create({
          data: {
            startedAt: session.startedAt,
            durationMinutes: actualMinutes,
            category: "Deep Work",
            note: `Focus session · ${session.label}`,
            taskId: session.taskId,
            projectId: session.task?.projectId ? null : session.projectId
          }
        });
      }
      await transaction.focusSession.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt: now,
          pausedAt: null,
          actualMinutes
        }
      });
    });

    return {
      completed: true,
      suggestedBreakMinutes:
        session.kind === "FOCUS" ? suggestedBreakMinutes(session.plannedMinutes) : null
    };
  }

  throw new FocusSessionError("Unknown timer action.");
}

export class FocusSessionError extends Error {}
export class FocusSessionConflictError extends FocusSessionError {}

function parseKind(value: unknown): FocusSessionKind {
  return String(value ?? "FOCUS").toUpperCase() === "BREAK" ? "BREAK" : "FOCUS";
}

function isActive(status: FocusSessionStatus) {
  return status === "RUNNING" || status === "PAUSED";
}
