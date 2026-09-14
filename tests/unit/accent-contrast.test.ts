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

/**
 * The surface each translucent --accent-soft is painted over, read from the
 * stylesheet rather than copied into this file, so retuning a theme cannot
 * leave the expected backdrop behind.
 *
 * This is the worst case, not the only case. Review established that the
 * controls using these pairings actually sit on --surface or --sidebar-bg,
 * both darker than --surface-2 in dark mode, and a darker backdrop only raises
 * contrast against a light tint. Checking the lightest backdrop bounds them all.
 */
const SURFACE_2 = {
  light: declaration(":root", "--surface-2"),
  dark: declaration('html[data-theme="dark"]', "--surface-2"),
  warm: declaration('html[data-theme="warm"]', "--surface-2")
};

const accents = ["sage", "blue", "clay", "iris"] as const;

for (const accent of accents) {
  // Warm defines no accent block of its own, so it inherits the light values
  // over its own surfaces. It is listed explicitly so that adding a warm accent
  // block later cannot slip past this check unnoticed.
  for (const theme of ["light", "dark", "warm"] as const) {
    const selector =
      theme === "dark"
        ? `html[data-theme="dark"][data-accent="${accent}"]`
        : `html[data-accent="${accent}"]`;

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

/**
 * Ordinary text, not just the accents.
 *
 * The accent checks above were written first and covered only accent pairings,
 * which is how a plain one survived review twice: warm --muted on --surface-2
 * measured 3.99:1 and nothing failed. These are the tokens every screen uses,
 * so they are checked the same way.
 */
for (const [theme, selector] of [
  ["light", ":root"],
  ["dark", 'html[data-theme="dark"]'],
  ["warm", 'html[data-theme="warm"]']
] as const) {
  for (const ink of ["--ink", "--muted"] as const) {
    for (const surface of ["--surface", "--surface-2"] as const) {
      test(`${theme}: ${ink} on ${surface} meets AA`, () => {
        const fg = declaration(selector, ink);
        const bg = declaration(selector, surface);
        const ratio = contrast(channels(fg), composite(bg, "#ffffff"));
        assert.ok(
          ratio >= AA_NORMAL,
          `${ink} ${fg} on ${surface} ${bg} is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1`
        );
      });
    }
  }
}

test("no rule paints var(--accent) as text on var(--accent-soft)", () => {
  // --accent is sized for use as a background behind --accent-foreground.
  // Reading it as text on --accent-soft is what failed review, so the pairing
  // is refused rather than left for the next rule that wants a tint.
  // (?<![-a-z]) matters: without it "border-color: var(--accent);" matches as a
  // suffix of "color:", and every rule that merely outlines a control in the
  // accent reads as a failure.
  const direct =
    /background:\s*var\(--accent-soft\)\s*;\s*(?<![-a-z])color:\s*var\(--accent\)\s*(!important)?\s*;/.test(css) ||
    /(?<![-a-z])color:\s*var\(--accent\)\s*(!important)?\s*;\s*background:\s*var\(--accent-soft\)\s*;/.test(css);
  assert.equal(direct, false, "use var(--accent-ink) for text on var(--accent-soft)");
});

test("accent-derived token pairs do not reintroduce the failing combination", () => {
  // The first version of this file only caught the literal declaration pair,
  // and review found the same failure routed through the sidebar tokens:
  // --sidebar-nav-active-bg took --accent-soft while --sidebar-nav-active-ink
  // took --accent, so every accent failed AA on the active nav item and this
  // test said nothing.
  //
  // The pairing has to be read inside one block. --sidebar-nav-active-ink is
  // declared in four of them, and an earlier attempt here matched the first
  // (var(--ink) in :root) and passed while the accent block was still wrong.
  let checked = 0;
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const [, stem] of body.matchAll(/--([a-z0-9-]+)-bg:\s*var\(--accent-soft\)\s*;/g)) {
      const ink = new RegExp(`--${stem}-ink:\\s*var\\(([^)]+)\\)\\s*;`).exec(body);
      assert.ok(ink, `--${stem}-bg takes --accent-soft but that block sets no --${stem}-ink`);
      assert.notEqual(
        ink![1].trim(),
        "--accent",
        `--${stem}-ink reads var(--accent) over var(--accent-soft); use var(--accent-ink)`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "expected at least one token pair backed by --accent-soft");
});