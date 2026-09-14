export type ThemeMode = "light" | "dark" | "warm" | "system";
export type AccentColor = "neutral" | "sage" | "blue" | "clay" | "iris";

export interface ThemeOption {
  readonly id: ThemeMode;
  readonly name: string;
  readonly description: string;
}

export interface AccentOption {
  readonly id: AccentColor;
  readonly name: string;
  readonly hex: string;
  readonly description: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "light",
    name: "Minimalist Light",
    description: "Clean, crisp slate ink on bright neutral cards"
  },
  {
    id: "dark",
    name: "Precision Dark",
    description: "Deep obsidian canvas with sleek high-contrast surfaces"
  },
  {
    id: "warm",
    name: "Warm Editorial",
    description: "Soft ivory and sepia paper inspired by classic print"
  },
  {
    id: "system",
    name: "System Match",
    description: "Automatically match your operating system theme"
  }
];

export const ACCENT_OPTIONS: readonly AccentOption[] = [
  {
    id: "neutral",
    name: "Monochrome",
    hex: "#1a1d24",
    description: "Minimalist neutral with zero color distraction"
  },
  {
    id: "sage",
    name: "Sage Green",
    hex: "#388464",
    description: "Subtle organic green for calm focus"
  },
  {
    id: "blue",
    name: "Focus Blue",
    hex: "#4f6ef7",
    description: "Vibrant electric blue for clarity and speed"
  },
  {
    id: "clay",
    name: "Sunset Clay",
    hex: "#e67e43",
    description: "Terracotta warmth and energy"
  },
  {
    id: "iris",
    name: "Royal Iris",
    hex: "#7c5cf6",
    description: "Deep purple for creative flow"
  }
];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "warm" || value === "system";
}

export function parseThemeMode(value: unknown, fallback: ThemeMode = "light"): ThemeMode {
  return isThemeMode(value) ? value : fallback;
}

export function isAccentColor(value: unknown): value is AccentColor {
  return (
    value === "neutral" ||
    value === "sage" ||
    value === "blue" ||
    value === "clay" ||
    value === "iris"
  );
}

export function parseAccentColor(value: unknown, fallback: AccentColor = "neutral"): AccentColor {
  return isAccentColor(value) ? value : fallback;
}

export function resolveEffectiveTheme(
  theme: ThemeMode,
  systemDark: boolean
): "light" | "dark" | "warm" {
  if (theme === "system") {
    return systemDark ? "dark" : "light";
  }
  return theme;
}
