import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeTestDatabase } from "../sqlite-test-helpers";

test("the lazy client binds the first-use URL and still honors scoped injection", () => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-lazy-prisma-"));
  const firstPath = join(directory, "first.db");
  const secondPath = join(directory, "second.db");
  try {
    for (const [path, title] of [[firstPath, "First"], [secondPath, "Second"]]) {
      initializeTestDatabase(`file:${path}`);
      const raw = new DatabaseSync(path);
      try {
        raw.prepare('INSERT INTO Task (id,title,createdAt,updatedAt) VALUES (?,?,?,?)')
          .run("fixture", title, 1785000000000, 1785000000000);
      } finally { raw.close(); }
    }
    // A fresh process observes real module evaluation, not an already-cached
    // import from another case. Both URLs are valid, so early capture produces
    // wrong data at the assertion, rather than a missing-file setup error.
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      const require=createRequire("file:///private/tmp/dayflow-prisma7-compat/package.json");
      // Match the CommonJS package condition used by the application's tsx modules.
      const {PrismaClient}=require('@prisma/client');
      const {PrismaBetterSqlite3}=require('@prisma/adapter-better-sqlite3');
      let connections=0;
      const connect=PrismaBetterSqlite3.prototype.connect;
      PrismaBetterSqlite3.prototype.connect=function(...args){connections++;return connect.apply(this,args);};
      process.env.DATABASE_URL=${JSON.stringify(`file:${firstPath}`)};
      const {getPrisma}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "src/lib/prisma.ts")).href)});
      const {createSqliteAdapter}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "src/server/prisma/sqlite.ts")).href)});
      assert.equal(connections,0,'module import must not open SQLite');
      process.env.DATABASE_URL=${JSON.stringify(`file:${secondPath}`)};
      const database=getPrisma();
      assert.equal(connections,0,'the adapter factory must remain unopened until a query');
      const injected=new PrismaClient({adapter:createSqliteAdapter(${JSON.stringify(`file:${firstPath}`)})});
      try {
        assert.equal((await database.task.findUniqueOrThrow({where:{id:'fixture'}})).title,'Second',
          'first query must use the URL supplied after module import');
        assert.equal(connections,1);
        process.env.DATABASE_URL=${JSON.stringify(`file:${firstPath}`)};
        assert.equal(getPrisma(),database,'a live singleton must not switch files when environment changes');
        globalThis.prisma=injected;
        assert.equal(getPrisma(),injected,'an explicit injected client must take precedence over the cached singleton');
      } finally {delete globalThis.prisma;await injected.$disconnect();await database.$disconnect();}
    `], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error || result.stdout));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
