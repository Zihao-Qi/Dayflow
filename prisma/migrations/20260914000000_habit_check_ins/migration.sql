CREATE TABLE "Habit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "cadence" TEXT NOT NULL DEFAULT 'DAILY',
  "targetPerWeek" INTEGER NOT NULL DEFAULT 7,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Habit_status_sortOrder_idx" ON "Habit" ("status", "sortOrder");

CREATE TABLE "HabitCheckIn" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "habitId" TEXT NOT NULL,
  "date" DATETIME NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT true,
  "amount" INTEGER,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "HabitCheckIn_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HabitCheckIn_habitId_date_key" ON "HabitCheckIn" ("habitId", "date");

CREATE INDEX "HabitCheckIn_date_idx" ON "HabitCheckIn" ("date");
