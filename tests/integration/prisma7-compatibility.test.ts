import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../../src/server/prisma/sqlite";
import { initializeTestDatabase } from "../sqlite-test-helpers";

test("the production adapter preserves Prisma 6 INTEGER dates in reads, ranges and new writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dayflow-prisma-date-compat-"));
  const path = join(directory, "legacy.db");
  const url = `file:${path}`;
  initializeTestDatabase(url);
  const early = new Date("2026-11-01T01:30:00.456-05:00");
  const late = new Date("2026-11-01T01:30:00.789-06:00");
  const leap = new Date("2024-02-29T06:00:00.123Z");
  // Independent SQLite fixture uses the actual Prisma 6 integer representation,
  // not the adapter under test to manufacture a compatible input.
  const raw = new DatabaseSync(path);
  const insert = raw.prepare('INSERT INTO Task (id,title,date,createdAt,updatedAt) VALUES (?,?,?,?,?)');
  for (const [id, date] of [["early", early], ["late", late], ["leap", leap]] as const) {
    insert.run(id, id, date.getTime(), leap.getTime(), late.getTime());
  }
  const database = new PrismaClient({ adapter: createSqliteAdapter(url) });
  try {
    const rows = await database.task.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(rows.map(row => [row.id, row.date?.toISOString()]), [
      ["early", early.toISOString()], ["late", late.toISOString()], ["leap", leap.toISOString()]
    ]);
    assert.deepEqual((await database.task.findMany({
      where: { date: { gte: early, lt: late } }, select: { id: true }
    })).map(row => row.id), ["early"], "legacy date range must include exactly the first DST-fold instant");
    await database.task.create({ data: { id: "new", title: "New write", date: early } });
    const stored = raw.prepare('SELECT typeof(date) AS kind,date FROM Task WHERE id=?').get("new");
    assert.equal(stored?.kind, "integer", "new data must not mix ISO text with integer dates");
    assert.equal(stored?.date, early.getTime());
  } finally {
    await database.$disconnect();
    raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
