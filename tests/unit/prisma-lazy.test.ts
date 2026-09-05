import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Evaluate the real module with a constructor spy: checking for a database file
// alone would miss PrismaClient construction before its first query.
const compiled = ts.transpileModule(
  readFileSync(new URL("../../src/lib/prisma.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function isolatedModule(environment: string) {
  const constructions: { log: string[] }[] = [];
  class PrismaClient {
    constructor(options: { log: string[] }) {
      constructions.push(options);
    }
  }
  const context = createContext({
    process: { env: { NODE_ENV: environment } },
    require: (specifier: string) => {
      assert.equal(specifier, "@prisma/client");
      return { PrismaClient };
    }
  });
  const evaluate = () => runInContext(
    `(function () { const exports = {}; ${compiled}\nreturn exports; })()`,
    context
  ) as { getPrisma: () => object };
  return { context, constructions, evaluate };
}

for (const environment of ["development", "test", "production"]) {
  test(`Prisma is constructed on first use and cached in ${environment}`, () => {
    const { context, constructions, evaluate } = isolatedModule(environment);
    const { getPrisma } = evaluate();
    assert.equal(constructions.length, 0, "module evaluation must not construct a client");
    assert.equal(context.prisma, undefined);

    const client = getPrisma();
    assert.equal(constructions.length, 1);
    assert.equal(getPrisma(), client);
    assert.equal(constructions.length, 1, "repeated calls reuse the same client");
    assert.deepEqual(
      Array.from(constructions[0].log),
      environment === "development" ? ["error", "warn"] : ["error"]
    );
    assert.equal(context.prisma, environment === "production" ? undefined : client);

    const reloaded = evaluate();
    assert.equal(constructions.length, 1, "reloading must also stay lazy");
    if (environment === "production") {
      assert.notEqual(reloaded.getPrisma(), client);
      assert.equal(constructions.length, 2);
    } else {
      assert.equal(reloaded.getPrisma(), client, "development/test reloads reuse globalThis");
      assert.equal(constructions.length, 1);
    }
  });
}

test("Prisma consults the development cache on first call, after module evaluation", () => {
  const { context, constructions, evaluate } = isolatedModule("development");
  const { getPrisma } = evaluate();
  const existingClient = {};
  context.prisma = existingClient;
  assert.equal(getPrisma(), existingClient);
  assert.equal(constructions.length, 0);
});

test("importing every production Prisma consumer leaves the client uninitialized", async (t) => {
  const previousEnvironment = process.env;
  t.after(() => {
    process.env = previousEnvironment;
  });
  // This assertion observes the global cache, which production does not populate.
  process.env = { ...previousEnvironment, NODE_ENV: "test" };
  const cache = globalThis as unknown as { prisma?: unknown };
  assert.equal(cache.prisma, undefined);
  const sourceRoot = join(process.cwd(), "src");
  const consumers = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .filter(file => file.endsWith(".ts"))
    .map(file => join(sourceRoot, file))
    .filter(file => readFileSync(file, "utf8").includes('from "@/lib/prisma"'));
  assert.ok(consumers.length > 0);
  for (const consumer of consumers) {
    await import(pathToFileURL(consumer).href);
    assert.equal(cache.prisma, undefined, `${consumer} must not construct Prisma at import time`);
  }
});
