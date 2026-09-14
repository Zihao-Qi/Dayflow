import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Every accent pairing must stay readable.
 *
 * Review of the Soft Bento redesign found three of the five accents failing
 * WCAG AA for button text - clay worst at 2.83:1 - and all four non-neutral
 * accents failing for accent-coloured text on their own soft background. Those
 * were hand-picked colours, so nothing in the build could notice. This reads
 * the real stylesheet and recomputes the ratios, which is the only form of this
 * check that cannot drift away from what ships.
 */

const css = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8"
);

const AA_NORMAL = 4.5;

function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `stylesheet no longer contains a rule for ${selector}`);
  return match![2];
}

function declaration(selector: string, property: string) {
  const found = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(block(selector));
  assert.ok(found, `${selector} no longer declares ${property}`);
  return found![1].trim();
}

function channels(colour: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const n = hex[1];
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as number[];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(colour.trim());
  assert.ok(rgba, `cannot parse colour ${colour}`);
  const parts = rgba![1].split(",").map((p) => Number(p.trim()));
  return parts.slice(0, 3);
}

function alphaOf(colour: string) {
  const rgba = /^rgba\(([^)]+)\)$/.exec(colour.trim());
  if (!rgba) return 1;
  const parts = rgba[1].split(",").map((p) => Number(p.trim()));
  return parts.length === 4 ? parts[3] : 1;
}

function composite(fg: string, bg: string) {
  const a = alphaOf(fg);
  if (a === 1) return channels(fg);
  const f = channels(fg);
  const b = channels(bg);
  return f.map((v, i) => Math.round(a * v + (1 - a) * b[i]));
}

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The surface each translucent --accent-soft is painted over.
const SURFACE_2 = { light: "#f4f6fb", dark: "#1c202d" };

const accents = ["sage", "blue", "clay", "iris"] as const;

for (const accent of accents) {
  for (const theme of ["light", "dark"] as const) {
    const selector =
      theme === "light"
        ? `html[data-accent="${accent}"]`
        : `html[data-theme="dark"][data-accent="${accent}"]`;

    test(`${accent} (${theme}): button text on the accent background meets AA`, () => {
      const background = declaration(selector, "--accent");
      const foreground = declaration(selector, "--accent-foreground");
      const ratio = contrast(channels(foreground), channels(background));
      assert.ok(
        ratio >= AA_NORMAL,
        `--accent-foreground ${foreground} on --accent ${background} is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1`
      );
    });

    test(`${accent} (${theme}): accent text on its soft background meets AA`, () => {
      const soft = declaration(selector, "--accent-soft");
      const ink = declaration(selector, "--accent-ink");
      const background = composite(soft, SURFACE_2[theme]);
      const ratio = contrast(channels(ink), background);
      assert.ok(
        ratio >= AA_NORMAL,
        `--accent-ink ${ink} on --accent-soft ${soft} is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1`
      );
    });
  }
}

test("accent-tinted text never reads var(--accent) straight from the stylesheet", () => {
  // --accent is sized for use as a background behind --accent-foreground. Using
  // it as text on --accent-soft is what failed review, so the pairing is banned
  // rather than left to be reintroduced by the next rule that wants a tint.
  assert.equal(
    css.includes("background: var(--accent-soft);\n  color: var(--accent);"),
    false,
    "a rule pairs colour var(--accent) with background var(--accent-soft); use var(--accent-ink)"
  );
});
