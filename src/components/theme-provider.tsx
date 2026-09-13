"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  type AccentColor,
  type ThemeMode,
  parseAccentColor,
  parseThemeMode,
  resolveEffectiveTheme
} from "@/lib/theme";

interface ThemeContextValue {
  theme: ThemeMode;
  accent: AccentColor;
  effectiveTheme: "light" | "dark" | "warm";
  setTheme: (mode: ThemeMode) => void;
  setAccent: (accent: AccentColor) => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemeToDocument(theme: ThemeMode, accent: AccentColor) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const effective = resolveEffectiveTheme(theme, getSystemDark());
  root.dataset.theme = effective;
  root.dataset.themePreference = theme;
  root.dataset.accent = accent;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [accent, setAccentState] = useState<AccentColor>("neutral");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const storedTheme = parseThemeMode(localStorage.getItem("dayflow_theme"), "light");
      const storedAccent = parseAccentColor(localStorage.getItem("dayflow_accent"), "neutral");
      setThemeState(storedTheme);
      setAccentState(storedAccent);
      applyThemeToDocument(storedTheme, storedAccent);
    } catch {
      // localStorage may be restricted or unavailable
    }
    setMounted(true);
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem("dayflow_theme", newTheme);
    } catch {
      // ignore
    }
    applyThemeToDocument(newTheme, accent);
  }, [accent]);

  const setAccent = useCallback((newAccent: AccentColor) => {
    setAccentState(newAccent);
    try {
      localStorage.setItem("dayflow_accent", newAccent);
    } catch {
      // ignore
    }
    applyThemeToDocument(theme, newAccent);
  }, [theme]);

  useEffect(() => {
    if (!mounted || theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      applyThemeToDocument("system", accent);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [mounted, theme, accent]);

  const effectiveTheme = resolveEffectiveTheme(theme, getSystemDark());

  return (
    <ThemeContext.Provider
      value={{
        theme,
        accent,
        effectiveTheme,
        setTheme,
        setAccent,
        mounted
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
