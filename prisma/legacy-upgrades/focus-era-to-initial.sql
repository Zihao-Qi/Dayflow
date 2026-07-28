ALTER TABLE "Task" ADD COLUMN "focusQueuePosition" INTEGER;
CREATE INDEX "Task_focusQueuePosition_idx"
  ON "Task"("focusQueuePosition");
