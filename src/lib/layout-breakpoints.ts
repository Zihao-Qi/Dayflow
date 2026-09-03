/**
 * Viewport widths the interface changes shape at.
 *
 * This module deliberately has no "use client" directive. It is read by the
 * client hook that watches resizes *and* by the server-rendered script that
 * stamps the layout attributes before first paint; if it lived behind a
 * client boundary, the server would serialize a client reference rather than
 * these values and the pre-paint script would silently do nothing.
 */
export const layoutBreakpoints = {
  phone: 620,
  // Chrome changes at 1180 because the sidebar and rail no longer fit; Figure
  // changes at 700 because its data no longer fits. Those constraints cannot
  // share a breakpoint.
  figure: 700,
  desktop: 1180,
  wideFocusRail: 1400
} as const;

export type LayoutMode = "phone" | "compact" | "desktop";

export function layoutModeForWidth(width: number): LayoutMode {
  if (width < layoutBreakpoints.phone) return "phone";
  if (width < layoutBreakpoints.desktop) return "compact";
  return "desktop";
}
