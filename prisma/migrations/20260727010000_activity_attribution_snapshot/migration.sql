ALTER TABLE "ActivityEntry"
ADD COLUMN "attributedProjectId" TEXT
REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "ActivityEntry"
SET "attributedProjectId" = COALESCE(
    "projectId",
    (
        SELECT "projectId"
        FROM "Task"
        WHERE "Task"."id" = "ActivityEntry"."taskId"
    )
);

CREATE INDEX "ActivityEntry_attributedProjectId_idx"
ON "ActivityEntry"("attributedProjectId");
