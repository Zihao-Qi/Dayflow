import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  GET as listBackups,
  POST as createBackup
} from "../../src/app/api/backups/route";
import {
  DELETE as cancelRestore,
  POST as stageRestore
} from "../../src/app/api/backups/restore/route";
import { BackupManagementError } from "../../src/lib/backup-management";
import { backupErrorResponse } from "../../src/lib/backup-http";

const repositoryRoot = process.cwd();

const localActionHeaders = {
  "Content-Type": "application/json",
  "Host": "127.0.0.1",
  "Origin": "http://127.0.0.1",
  "X-Dayflow-Local-Action": "1"
};

test("backup mutations reject requests without the local-action guard", async () => {
  const response = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
});

test("backup mutations reject malformed JSON and browser-supplied paths", async () => {
  const malformed = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: localActionHeaders,
      body: "{"
    })
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "INVALID_JSON");

  const arbitraryPath = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: localActionHeaders,
      body: JSON.stringify({ outputPath: "/tmp/not-allowed" })
    })
  );
  assert.equal(arbitraryPath.status, 400);
  assert.equal((await arbitraryPath.json()).code, "VALIDATION_ERROR");
});

test("restore staging requires exact confirmation before filesystem access", async () => {
  const response = await stageRestore(
    new NextRequest("http://127.0.0.1/api/backups/restore", {
      method: "POST",
      headers: localActionHeaders,
      body: JSON.stringify({
        backupId: "a".repeat(43),
        expectedPayloadSha256: "b".repeat(64),
        confirmation: "restore"
      })
    })
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(body.field, "confirmation");
});

test("backup mutations reject cross-origin requests", async () => {
  const response = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: {
        ...localActionHeaders,
        Origin: "https://example.com"
      },
      body: "{}"
    })
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
});

test("backup guards pin exact forbidden and unsupported-media envelopes", async () => {
  const missingGuard = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
  assert.equal(missingGuard.status, 403);
  assert.deepEqual(await missingGuard.json(), {
    error: "This local data action requires an explicit Dayflow request.",
    code: "FORBIDDEN"
  });

  const unsupportedMedia = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: {
        Host: "127.0.0.1",
        Origin: "http://127.0.0.1",
        "X-Dayflow-Local-Action": "1",
        "Content-Type": "text/plain"
      },
      body: "{}"
    })
  );
  assert.equal(unsupportedMedia.status, 415);
  assert.deepEqual(await unsupportedMedia.json(), {
    error: "Use application/json for local data actions.",
    code: "UNSUPPORTED_MEDIA_TYPE"
  });

  const crossOrigin = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: { ...localActionHeaders, Origin: "https://example.com" },
      body: "{}"
    })
  );
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), {
    error: "Cross-origin local data actions are not allowed.",
    code: "FORBIDDEN"
  });

  const crossSite = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: { ...localActionHeaders, "Sec-Fetch-Site": "cross-site" },
      body: "{}"
    })
  );
  assert.equal(crossSite.status, 403);
  assert.deepEqual(await crossSite.json(), {
    error: "Cross-site local data requests are not allowed.",
    code: "FORBIDDEN"
  });
});

test("backup error mapping pins management statuses, optional fields, and fallback", async () => {
  const cases: Array<[BackupManagementError, number, Record<string, unknown>]> = [
    [
      new BackupManagementError(
        "The backup identifier is invalid.",
        "VALIDATION_ERROR",
        400,
        "backupId"
      ),
      400,
      {
        error: "The backup identifier is invalid.",
        code: "VALIDATION_ERROR",
        field: "backupId"
      }
    ],
    [
      new BackupManagementError(
        "The selected backup could not be found.",
        "NOT_FOUND",
        404,
        "backupId"
      ),
      404,
      {
        error: "The selected backup could not be found.",
        code: "NOT_FOUND",
        field: "backupId"
      }
    ],
    [
      new BackupManagementError(
        "Another restore is already pending.",
        "CONFLICT",
        409
      ),
      409,
      { error: "Another restore is already pending.", code: "CONFLICT" }
    ],
    [
      new BackupManagementError(
        "The selected backup is corrupt or incompatible and cannot be restored.",
        "CORRUPT_BACKUP",
        422,
        "backupId"
      ),
      422,
      {
        error: "The selected backup is corrupt or incompatible and cannot be restored.",
        code: "CORRUPT_BACKUP",
        field: "backupId"
      }
    ],
    [
      new BackupManagementError(
        "Restore scheduling is disabled in this Dayflow process.",
        "RESTORE_DISABLED",
        503
      ),
      503,
      {
        error: "Restore scheduling is disabled in this Dayflow process.",
        code: "RESTORE_DISABLED"
      }
    ]
  ];

  for (const [error, status, body] of cases) {
    const response = backupErrorResponse(error, "Backup operation");
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const fallback = backupErrorResponse(new Error("unexpected"), "Backup list");
    assert.equal(fallback.status, 500);
    assert.deepEqual(await fallback.json(), {
      error: "Backup list could not be completed.",
      code: "INTERNAL_ERROR"
    });
    for (const [operation, error] of [
      ["Backup creation", "Backup creation could not be completed."],
      [
        "Automatic backup settings",
        "Automatic backup settings could not be completed."
      ],
      ["Backup download", "Backup download could not be completed."],
      ["Restore scheduling", "Restore scheduling could not be completed."],
      ["Restore cancellation", "Restore cancellation could not be completed."]
    ] as const) {
      const operationFallback = backupErrorResponse(
        new Error("unexpected"),
        operation
      );
      assert.equal(operationFallback.status, 500);
      assert.deepEqual(await operationFallback.json(), {
        error,
        code: "INTERNAL_ERROR"
      });
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("backup route-specific validation envelopes are exact", async () => {
  const malformed = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: localActionHeaders,
      body: "{"
    })
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "The request body must be valid JSON.",
    code: "INVALID_JSON"
  });

  const nonObject = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: localActionHeaders,
      body: "[]"
    })
  );
  assert.equal(nonObject.status, 400);
  assert.deepEqual(await nonObject.json(), {
    error: "The request body must be a JSON object.",
    code: "VALIDATION_ERROR"
  });

  const destination = await createBackup(
    new NextRequest("http://127.0.0.1/api/backups", {
      method: "POST",
      headers: localActionHeaders,
      body: JSON.stringify({ outputPath: "/tmp/not-allowed" })
    })
  );
  assert.equal(destination.status, 400);
  assert.deepEqual(await destination.json(), {
    error: "Backup creation does not accept a destination path.",
    code: "VALIDATION_ERROR"
  });

  const unexpectedRestore = await stageRestore(
    jsonRequest("http://127.0.0.1/api/backups/restore", "POST", {
      unexpected: true
    })
  );
  assert.equal(unexpectedRestore.status, 400);
  assert.deepEqual(await unexpectedRestore.json(), {
    error: "Unexpected restore field: unexpected.",
    code: "VALIDATION_ERROR",
    field: "unexpected"
  });

  const missingBackup = await stageRestore(
    jsonRequest("http://127.0.0.1/api/backups/restore", "POST", {})
  );
  assert.equal(missingBackup.status, 400);
  assert.deepEqual(await missingBackup.json(), {
    error: "Choose a managed backup.",
    code: "VALIDATION_ERROR",
    field: "backupId"
  });

  const missingChecksum = await stageRestore(
    jsonRequest("http://127.0.0.1/api/backups/restore", "POST", {
      backupId: "backup"
    })
  );
  assert.equal(missingChecksum.status, 400);
  assert.deepEqual(await missingChecksum.json(), {
    error: "The selected backup checksum is required.",
    code: "VALIDATION_ERROR",
    field: "expectedPayloadSha256"
  });

  const cancelFields = await cancelRestore(
    jsonRequest("http://127.0.0.1/api/backups/restore", "DELETE", {
      backupId: "not-accepted"
    })
  );
  assert.equal(cancelFields.status, 400);
  assert.deepEqual(await cancelFields.json(), {
    error: "Canceling a restore does not accept any fields.",
    code: "VALIDATION_ERROR"
  });
});

test(
  "backup routes create, stage, and cancel recovery using isolated local data",
  { timeout: 120_000 },
  async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dayflow-backup-routes-")
    );
    const activeDatabase = join(temporaryDirectory, "active.db");
    const backupDirectory = join(temporaryDirectory, "backups");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousBackupDirectory = process.env.DAYFLOW_BACKUP_DIRECTORY;
    const previousDisableRestore = process.env.DAYFLOW_DISABLE_RESTORE;

    try {
      initializeDatabase(activeDatabase);
      process.env.DATABASE_URL = `file:${activeDatabase}`;
      process.env.DAYFLOW_BACKUP_DIRECTORY = backupDirectory;
      delete process.env.DAYFLOW_DISABLE_RESTORE;

      assert.equal(existsSync(backupDirectory), false);
      const listResponse = await listBackups(
        new NextRequest("http://127.0.0.1/api/backups", {
          method: "GET",
          headers: { Host: "127.0.0.1" }
        })
      );
      assert.equal(listResponse.status, 200);
      const listBody = await listResponse.json();
      assert.equal(listBody.directory, backupDirectory);
      assert.deepEqual(listBody.backups, []);
      assert.equal(listBody.pendingRestore, null);
      assert.equal(listBody.lastRestore, null);
      assert.equal(
        existsSync(backupDirectory),
        false,
        "GET /api/backups must not initialize managed storage."
      );

      const createResponse = await createBackup(
        jsonRequest("http://127.0.0.1/api/backups", "POST", {})
      );
      assert.equal(createResponse.status, 201);
      assert.equal(
        existsSync(backupDirectory),
        true,
        "POST /api/backups should initialize managed storage."
      );
      const createBody = await createResponse.json();
      assert.equal(createBody.backup.status, "verified");
      assert.equal(typeof createBody.backup.id, "string");
      assert.match(createBody.backup.payloadSha256, /^[a-f0-9]{64}$/);

      const stageResponse = await stageRestore(
        jsonRequest("http://127.0.0.1/api/backups/restore", "POST", {
          backupId: createBody.backup.id,
          expectedPayloadSha256: createBody.backup.payloadSha256,
          confirmation: "RESTORE"
        })
      );
      assert.equal(stageResponse.status, 202);
      const stageBody = await stageResponse.json();
      assert.equal(stageBody.pendingRestore.status, "pending_restart");
      assert.equal(stageBody.pendingRestore.backupId, createBody.backup.id);

      const cancelResponse = await cancelRestore(
        jsonRequest("http://127.0.0.1/api/backups/restore", "DELETE", {})
      );
      assert.equal(cancelResponse.status, 200);
      const cancelBody = await cancelResponse.json();
      assert.equal(cancelBody.pendingRestore, null);
      assert.equal(
        cancelBody.backups.some(
          (backup: { id?: unknown }) => backup.id === createBody.backup.id
        ),
        true
      );
    } finally {
      restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
      restoreEnvironment(
        "DAYFLOW_BACKUP_DIRECTORY",
        previousBackupDirectory
      );
      restoreEnvironment("DAYFLOW_DISABLE_RESTORE", previousDisableRestore);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

function jsonRequest(
  url: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: localActionHeaders,
    body: JSON.stringify(body)
  });
}

function initializeDatabase(databasePath: string) {
  execFileSync("sqlite3", ["-batch", "-bail", databasePath], {
    cwd: repositoryRoot,
    input: readFileSync(join(repositoryRoot, "prisma/init.sql")),
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
