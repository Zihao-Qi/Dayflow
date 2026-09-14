import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCENT_OPTIONS,
  THEME_OPTIONS,
  isAccentColor,
  isThemeMode,
  parseAccentColor,
  parseThemeMode,
  resolveEffectiveTheme
} from "../../src/lib/theme";

test("THEME_OPTIONS covers all expected modes with unique identifiers", () => {
  const ids = THEME_OPTIONS.map((opt) => opt.id);
  assert.deepEqual(ids, ["light", "dark", "warm", "system"]);
  assert.equal(new Set(ids).size, 4);
});

test("ACCENT_OPTIONS covers all expected accents with unique identifiers and valid hex codes", () => {
  const ids = ACCENT_OPTIONS.map((opt) => opt.id);
  assert.deepEqual(ids, ["neutral", "sage", "blue", "clay", "iris"]);
  assert.equal(new Set(ids).size, 5);
  for (const opt of ACCENT_OPTIONS) {
    assert.match(opt.hex, /^#[0-9a-fA-F]{6}$/);
  }
});

test("isThemeMode and parseThemeMode validate allowed modes and apply fallback", () => {
  assert.equal(isThemeMode("light"), true);
  assert.equal(isThemeMode("dark"), true);
  assert.equal(isThemeMode("warm"), true);
  assert.equal(isThemeMode("system"), true);
  assert.equal(isThemeMode("invalid"), false);
  assert.equal(isThemeMode(null), false);
  assert.equal(isThemeMode(undefined), false);
  assert.equal(isThemeMode(123), false);

  assert.equal(parseThemeMode("dark"), "dark");
  assert.equal(parseThemeMode("warm"), "warm");
  assert.equal(parseThemeMode("nonexistent"), "light");
  assert.equal(parseThemeMode("nonexistent", "dark"), "dark");
  assert.equal(parseThemeMode(null, "warm"), "warm");
});

test("isAccentColor and parseAccentColor validate allowed accents and apply fallback", () => {
  assert.equal(isAccentColor("neutral"), true);
  assert.equal(isAccentColor("sage"), true);
  assert.equal(isAccentColor("blue"), true);
  assert.equal(isAccentColor("clay"), true);
  assert.equal(isAccentColor("iris"), true);
  assert.equal(isAccentColor("neon-pink"), false);
  assert.equal(isAccentColor(null), false);
  assert.equal(isAccentColor({}), false);

  assert.equal(parseAccentColor("blue"), "blue");
  assert.equal(parseAccentColor("clay"), "clay");
  assert.equal(parseAccentColor("neon-pink"), "neutral");
  assert.equal(parseAccentColor("neon-pink", "iris"), "iris");
  assert.equal(parseAccentColor(undefined, "sage"), "sage");
});

test("resolveEffectiveTheme maps static themes directly and resolves system according to OS match", () => {
  assert.equal(resolveEffectiveTheme("light", false), "light");
  assert.equal(resolveEffectiveTheme("light", true), "light");
  assert.equal(resolveEffectiveTheme("dark", false), "dark");
  assert.equal(resolveEffectiveTheme("dark", true), "dark");
  assert.equal(resolveEffectiveTheme("warm", false), "warm");
  assert.equal(resolveEffectiveTheme("warm", true), "warm");

  assert.equal(resolveEffectiveTheme("system", true), "dark");
  assert.equal(resolveEffectiveTheme("system", false), "light");
});
