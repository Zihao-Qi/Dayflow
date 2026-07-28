import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
// The legacy completion transaction wrote Activity.createdAt and
// FocusSession.recordedAt together. Content alone is not provenance because a
// manual Activity can be identical.
const legacyFocusCreationWindowMs = 2_000;

async function reconcileEvidence() {
  const report = await prisma.$transaction(async (transaction) => {
    const activeSessions = await transaction.focusSession.findMany({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      orderBy: { startedAt: "desc" },
      select: { id: true }
    });
    const retainedActiveId = activeSessions[0]?.id ?? null;
    let canceledDuplicateSessions = 0;

    if (retainedActiveId) {
      const canceled = await transaction.focusSession.updateMany({
        where: {
          status: { in: ["RUNNING", "PAUSED"] },
          id: { not: retainedActiveId }
        },
        data: {
          activeKey: null,
          status: "CANCELED",
          completedAt: new Date()
        }
      });
      canceledDuplicateSessions = canceled.count;
      await transaction.focusSession.update({
        where: { id: retainedActiveId },
        data: { activeKey: 1 }
      });
    }

    const sessions = await transaction.focusSession.findMany({
      where: {
        kind: "FOCUS",
        status: "COMPLETED",
        actualMinutes: { gte: 1 }
      },
      orderBy: { startedAt: "asc" },
      include: {
        activity: { select: { id: true, origin: true } },
        task: { select: { title: true, projectId: true } }
      }
    });

    let linkedActivities = 0;
    let createdActivities = 0;
    let normalizedActivities = 0;

    for (const session of sessions) {
      if (session.activity) {
        if (session.activity.origin !== "FOCUS") {
          await transaction.activityEntry.update({
            where: { id: session.activity.id },
            data: { origin: "FOCUS" }
          });
          normalizedActivities += 1;
        }
        continue;
      }

      const projectId = session.task?.projectId ? null : session.projectId;
      const attributedProjectId =
        session.task?.projectId ?? session.projectId;
      const expectedCategory = session.completionCategory || "Deep Work";
      const expectedNote =
        session.completionNote ||
        session.task?.title ||
        session.label ||
        "Focus session";
      const candidates = session.needsEnrichment
        ? []
        : await transaction.activityEntry.findMany({
            where: {
              focusSessionId: null,
              startedAt: session.startedAt,
              durationMinutes: session.actualMinutes,
              taskId: session.taskId,
              projectId,
              attributedProjectId,
              category: expectedCategory,
              note: expectedNote
            },
            select: { id: true, origin: true, createdAt: true }
          });

      const trustedCandidates = candidates.filter(
        (candidate) =>
          candidate.origin === "FOCUS" ||
          (session.enrichedAt !== null &&
            Math.abs(
              candidate.createdAt.getTime() - session.enrichedAt.getTime()
            ) <= legacyFocusCreationWindowMs)
      );

      if (trustedCandidates.length > 1) {
        throw new Error(
          `Focus Session ${session.id} has ${trustedCandidates.length} provenance-backed Activity matches. Resolve the ambiguity before retrying reconciliation.`
        );
      }

      if (trustedCandidates.length === 1) {
        await transaction.activityEntry.update({
          where: { id: trustedCandidates[0].id },
          data: {
            origin: "FOCUS",
            focusSessionId: session.id
          }
        });
        linkedActivities += 1;
        continue;
      }

      await transaction.activityEntry.create({
        data: {
          startedAt: session.startedAt,
          durationMinutes: session.actualMinutes,
          category: expectedCategory,
          note: expectedNote,
          origin: "FOCUS",
          taskId: session.taskId,
          projectId,
          attributedProjectId,
          focusSessionId: session.id
        }
      });
      createdActivities += 1;
    }

    const legacyTasks = await transaction.task.findMany({
      where: { actualMinutes: { gt: 0 } },
      select: {
        id: true,
        title: true,
        date: true,
        completedAt: true,
        updatedAt: true,
        actualMinutes: true,
        projectId: true,
        activities: { select: { id: true, durationMinutes: true } }
      }
    });
    let createdLegacyTaskActivities = 0;
    for (const task of legacyTasks) {
      const legacyActivityId = `legacy-task-${task.id}`;
      if (task.activities.some((activity) => activity.id === legacyActivityId)) {
        continue;
      }
      const representedMinutes = task.activities.reduce(
        (sum, activity) => sum + activity.durationMinutes,
        0
      );
      const missingMinutes = task.actualMinutes - representedMinutes;
      if (missingMinutes <= 0) continue;
      await transaction.activityEntry.create({
        data: {
          id: legacyActivityId,
          startedAt: task.completedAt ?? task.date ?? task.updatedAt,
          durationMinutes: missingMinutes,
          category: "Legacy task time",
          note: task.title,
          origin: "MANUAL",
          taskId: task.id,
          projectId: null,
          attributedProjectId: task.projectId
        }
      });
      createdLegacyTaskActivities += 1;
    }

    return {
      retainedActiveId,
      canceledDuplicateSessions,
      linkedActivities,
      createdActivities,
      normalizedActivities,
      createdLegacyTaskActivities
    };
  });

  console.log(JSON.stringify(report, null, 2));
}

reconcileEvidence()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
