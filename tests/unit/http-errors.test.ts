import assert from "node:assert/strict";
import test from "node:test";
import { backupErrors } from "../../src/lib/backup-errors";
import { serializeAppError } from "../../src/lib/http-errors";
import { journalAppError } from "../../src/lib/journal-errors";
import { projectErrors } from "../../src/lib/project-errors";
import { timeBlockOverlapError } from "../../src/lib/time-block-errors";
import { AppError, validation } from "../../src/shared/kernel/errors";

test("AppError serializes declared keys in their historical order without leaking its cause", () => {
  const cause = new Error("private storage diagnostic");
  const error = new AppError({
    status: 409,
    message: "Conflict.",
    code: "CONFLICT",
    field: "id"
  }, cause);
  assert.equal(error.cause, cause);
  assert.equal(error.message, "Conflict.");
  const result = serializeAppError(error);
  assert.equal(result.status, 409);
  assert.equal(JSON.stringify(result.body), '{"error":"Conflict.","code":"CONFLICT","field":"id"}');
  assert.equal(JSON.stringify(serializeAppError(validation("Invalid.")).body),
    '{"error":"Invalid.","code":"VALIDATION_ERROR"}');
});

test("Journal adapts receipt order without changing the receipt envelope elsewhere", () => {
  const error = new AppError({
    status: 409,
    message: "This mutation identifier was already used for a different request.",
    code: "MUTATION_ID_CONFLICT"
  });
  const journal = serializeAppError(journalAppError(error));
  assert.equal(journal.status, 409);
  assert.equal(JSON.stringify(journal.body),
    '{"code":"MUTATION_ID_CONFLICT","error":"This mutation identifier was already used for a different request."}');
  assert.deepEqual(Object.keys(serializeAppError(error).body), ["error", "code"]);
});

test("Catalog serialization preserves code-less and extended Project envelopes and backup 422", () => {
  assert.equal(JSON.stringify(serializeAppError(new AppError(projectErrors.projectDetailNotFound)).body),
    '{"error":"Project not found."}');
  assert.equal(JSON.stringify(serializeAppError(new AppError(projectErrors.confirmCompletionWhileUnfinishedTasksRemain)).body),
    '{"error":"Confirm completion while unfinished tasks remain.","code":"CONFLICT","field":"status","requiresConfirmation":true}');
  const backup = serializeAppError(new AppError(backupErrors.theSelectedBackupIsCorruptOrIncompatibleAndCannotBeRestored));
  assert.equal(backup.status, 422);
  assert.equal(JSON.stringify(backup.body),
    '{"error":"The selected backup is corrupt or incompatible and cannot be restored.","code":"CORRUPT_BACKUP","field":"backupId"}');
});

test("Time Block overlap preserves arbitrary titles verbatim while formatting the interval", () => {
  const result = serializeAppError(timeBlockOverlapError({
    title: 'Planning {startTime} "$&"', startTime: "09:00", endTime: "10:00"
  }));
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: 'This Time Block overlaps "Planning {startTime} "$&"" at 09:00–10:00.',
    code: "TIME_BLOCK_OVERLAP",
    field: "startTime"
  });
});
