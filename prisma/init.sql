PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "desiredOutcome" TEXT NOT NULL DEFAULT '',
  "targetDate" DATETIME,
  "targetDurationValue" INTEGER,
  "targetDurationUnit" TEXT,
  "weeklyMinutesBudget" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "Project_status_idx" ON "Project" ("status");

CREATE TABLE IF NOT EXISTS "ProjectPhase" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProjectPhase_projectId_sortOrder_idx" ON "ProjectPhase" ("projectId", "sortOrder");

CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "date" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "urgentScore" INTEGER NOT NULL DEFAULT 2,
  "importanceScore" INTEGER NOT NULL DEFAULT 3,
  "deadline" DATETIME,
  "estimateMinutes" INTEGER NOT NULL DEFAULT 30,
  "actualMinutes" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "projectId" TEXT,
  "phaseId" TEXT,
  CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Task_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Task_date_idx" ON "Task" ("date");
CREATE INDEX IF NOT EXISTS "Task_projectId_idx" ON "Task" ("projectId");
CREATE INDEX IF NOT EXISTS "Task_phaseId_idx" ON "Task" ("phaseId");

CREATE TABLE IF NOT EXISTS "Note" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "content" TEXT NOT NULL,
  "tags" TEXT NOT NULL DEFAULT '[]',
  "date" DATETIME NOT NULL,
  "taskId" TEXT,
  "projectId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Note_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Note_projectId_idx" ON "Note" ("projectId");

CREATE TABLE IF NOT EXISTS "DiaryEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" DATETIME NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "reflection" TEXT NOT NULL DEFAULT '',
  "mood" INTEGER NOT NULL DEFAULT 3,
  "energy" INTEGER NOT NULL DEFAULT 3,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiaryEntry_date_key" ON "DiaryEntry" ("date");

CREATE TABLE IF NOT EXISTS "Material" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'website',
  "notes" TEXT NOT NULL DEFAULT '',
  "taskId" TEXT,
  "noteId" TEXT,
  "projectId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Material_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Material_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Material_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Material_projectId_idx" ON "Material" ("projectId");

CREATE TABLE IF NOT EXISTS "TimeBlock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" DATETIME NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "taskId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TimeBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ActivityEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "startedAt" DATETIME NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "taskId" TEXT,
  "projectId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ActivityEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ActivityEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ActivityEntry_startedAt_idx" ON "ActivityEntry" ("startedAt");
CREATE INDEX IF NOT EXISTS "ActivityEntry_taskId_idx" ON "ActivityEntry" ("taskId");
CREATE INDEX IF NOT EXISTS "ActivityEntry_projectId_idx" ON "ActivityEntry" ("projectId");

CREATE TABLE IF NOT EXISTS "FocusSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'FOCUS',
  "plannedMinutes" INTEGER NOT NULL,
  "actualMinutes" INTEGER NOT NULL DEFAULT 0,
  "label" TEXT NOT NULL DEFAULT '',
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pausedAt" DATETIME,
  "accumulatedPauseSeconds" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "completedAt" DATETIME,
  "needsRecord" BOOLEAN NOT NULL DEFAULT false,
  "recordedAt" DATETIME,
  "completionNote" TEXT,
  "completionCategory" TEXT,
  "taskId" TEXT,
  "projectId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FocusSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FocusSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FocusSession_status_idx" ON "FocusSession" ("status");
CREATE INDEX IF NOT EXISTS "FocusSession_completedAt_idx" ON "FocusSession" ("completedAt");
CREATE INDEX IF NOT EXISTS "FocusSession_taskId_idx" ON "FocusSession" ("taskId");
CREATE INDEX IF NOT EXISTS "FocusSession_projectId_idx" ON "FocusSession" ("projectId");

CREATE TABLE IF NOT EXISTS "TaskScheduleChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "previousDate" DATETIME,
  "nextDate" DATETIME,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskScheduleChange_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TaskScheduleChange_taskId_createdAt_idx" ON "TaskScheduleChange" ("taskId", "createdAt");
