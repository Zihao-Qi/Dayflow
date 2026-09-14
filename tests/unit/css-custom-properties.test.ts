import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Every custom property the stylesheet reads must be defined somewhere in it.
 *
 * An unresolved var() does not degrade gracefully: it invalidates the whole
 * declaration at computed-value time, so the element silently falls back to
 * whatever it inherits. Nothing fails, nothing logs, and the page merely looks
 * slightly wrong.
 *
 * The Soft Bento redesign dropped --text-lg while thirteen rules still read it,
 * and every gate stayed green - no test asserts a font size, so the 19px
 * subheading hierarchy simply stopped applying. This is the cheap check that
 * would have caught it.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const defined = new Set(
  [...css.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)].map((m) => m[2])
);

/**
 * Some properties are supplied by components as inline style, not by the
 * stylesheet - the timeline heights in day-workspace.tsx are measured at
 * runtime. Those are legitimate reads, so the source tree counts as a
 * definition site too.
 */
function collectFromSource(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFromSource(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const source = readFileSync(full, "utf8");
      for (const m of source.matchAll(/["'`](--[a-z0-9-]+)["'`]\s*:/gi)) {
        defined.add(m[1]);
      }
      for (const m of source.matchAll(/setProperty\(\s*["'`](--[a-z0-9-]+)["'`]/gi)) {
        defined.add(m[1]);
      }
    }
  }
}
collectFromSource(join(process.cwd(), "src"));

// var(--x, fallback) is legitimate without a definition, so only bare reads count.
const read = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]);

test("every custom property read by globals.css is defined in it", () => {
  const missing = [...new Set(read.filter((token) => !defined.has(token)))].sort();
  assert.deepEqual(
    missing,
    [],
    `read but never defined: ${missing.join(", ")} — an unresolved var() invalidates the whole declaration`
  );
});

test("the check is not vacuous", () => {
  assert.ok(defined.size > 20, `expected a real token set, found ${defined.size}`);
  assert.ok(read.length > 50, `expected many var() reads, found ${read.length}`);
});
