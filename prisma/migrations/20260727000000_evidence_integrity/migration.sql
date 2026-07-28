ALTER TABLE "FocusSession" ADD COLUMN "activeKey" INTEGER;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ActivityEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "taskId" TEXT,
    "projectId" TEXT,
    "focusSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActivityEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityEntry_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ActivityEntry" (
    "category",
    "createdAt",
    "durationMinutes",
    "id",
    "note",
    "projectId",
    "startedAt",
    "taskId",
    "updatedAt"
)
SELECT
    "category",
    "createdAt",
    "durationMinutes",
    "id",
    "note",
    "projectId",
    "startedAt",
    "taskId",
    "updatedAt"
FROM "ActivityEntry";

DROP TABLE "ActivityEntry";
ALTER TABLE "new_ActivityEntry" RENAME TO "ActivityEntry";

CREATE UNIQUE INDEX "ActivityEntry_focusSessionId_key" ON "ActivityEntry"("focusSessionId");
CREATE INDEX "ActivityEntry_startedAt_idx" ON "ActivityEntry"("startedAt");
CREATE INDEX "ActivityEntry_taskId_idx" ON "ActivityEntry"("taskId");
CREATE INDEX "ActivityEntry_projectId_idx" ON "ActivityEntry"("projectId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

UPDATE "FocusSession"
SET
    "status" = 'CANCELED',
    "completedAt" = COALESCE("completedAt", "startedAt"),
    "activeKey" = NULL
WHERE
    "status" IN ('RUNNING', 'PAUSED')
    AND "id" <> (
        SELECT "id"
        FROM "FocusSession"
        WHERE "status" IN ('RUNNING', 'PAUSED')
        ORDER BY "startedAt" DESC
        LIMIT 1
    );

UPDATE "FocusSession"
SET "activeKey" = 1
WHERE "status" IN ('RUNNING', 'PAUSED');

CREATE UNIQUE INDEX "FocusSession_activeKey_key" ON "FocusSession"("activeKey");
