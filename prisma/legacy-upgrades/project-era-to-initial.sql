ALTER TABLE "Task" ADD COLUMN "focusQueuePosition" INTEGER;
CREATE INDEX "Task_focusQueuePosition_idx"
  ON "Task"("focusQueuePosition");

ALTER TABLE "FocusSession"
  ADD COLUMN "needsRecord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FocusSession" ADD COLUMN "recordedAt" DATETIME;
ALTER TABLE "FocusSession" ADD COLUMN "completionNote" TEXT;
ALTER TABLE "FocusSession" ADD COLUMN "completionCategory" TEXT;
