CREATE TABLE "Review" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "periodStart" DATETIME NOT NULL,
  "periodEnd" DATETIME NOT NULL,
  "narrative" TEXT NOT NULL DEFAULT '',
  "nextPeriodIntention" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Review_periodStart_periodEnd_key"
ON "Review"("periodStart", "periodEnd");
