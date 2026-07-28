CREATE TABLE "MutationReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "MutationReceipt_createdAt_idx" ON "MutationReceipt" ("createdAt");
