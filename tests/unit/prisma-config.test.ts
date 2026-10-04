import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prismaDatasourceUrl } from "../../src/lib/prisma-config";
import { sqliteDatabaseUrlForPath, sqlitePathFromDatabaseUrl } from "../../src/lib/sqlite-path";

test("CLI configuration preserves explicit URLs, schema-relative files and no-DB generation", () => {
  const root = mkdtempSync(join(tmpdir(), "dayflow-prisma-config-"));
  try {
    assert.equal(prismaDatasourceUrl(root, {}), undefined);
    writeFileSync(join(root, ".env"), 'DATABASE_URL="file:./from-env.db"\n');
    assert.equal(prismaDatasourceUrl(root, {}), sqliteDatabaseUrlForPath(join(root, "prisma", "from-env.db")));
    const explicit = join(root, "scratch #? database.db");
    const url = sqliteDatabaseUrlForPath(explicit);
    assert.equal(prismaDatasourceUrl(root, { DATABASE_URL: url }), url,
      "an explicit scratch URL must beat .env and survive encoded delimiters");
    assert.equal(sqlitePathFromDatabaseUrl(url, root), explicit);
    assert.equal(prismaDatasourceUrl(root, { DATABASE_URL: "" }), undefined,
      "an explicitly empty URL must not silently pick the .env database");
    assert.equal(sqlitePathFromDatabaseUrl("file:./same.db?socket_timeout=5", root), join(root, "prisma", "same.db"));
    for (const invalid of ["postgresql://localhost/db", "file:", "file::memory:", "file:bad%ZZ", "file:bad%00name"]) {
      assert.throws(() => prismaDatasourceUrl(root, { DATABASE_URL: invalid }), /DATABASE_URL/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
