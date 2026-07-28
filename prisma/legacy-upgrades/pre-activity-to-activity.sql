PRAGMA foreign_keys=OFF;

CREATE TABLE "ActivityEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "startedAt" DATETIME NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "taskId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ActivityEntry_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ActivityEntry_startedAt_idx"
  ON "ActivityEntry"("startedAt");
CREATE INDEX "ActivityEntry_taskId_idx"
  ON "ActivityEntry"("taskId");

PRAGMA foreign_keys=ON;
