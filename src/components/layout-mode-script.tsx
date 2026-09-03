import { layoutBreakpoints } from "@/lib/layout-breakpoints";

/**
 * Dayflow's responsive rules key off `data-layout-mode` on the root element
 * rather than media queries, and that attribute is normally stamped by
 * `useLayoutMode` from an effect. The server cannot know the viewport width,
 * so without this a phone paints the desktop chrome for one frame and then
 * snaps.
 *
 * This runs synchronously before first paint and stamps the same attributes
 * `useLayoutMode` would, from the same breakpoints, so the first frame is
 * already correct.
 *
 * It writes to `documentElement`, which React renders and therefore diffs, so
 * `RootLayout` carries `suppressHydrationWarning` on `<html>`. Without it,
 * React reports these attributes as a mismatch on every load.
 *
 * `layoutBreakpoints` must come from a module with no "use client" directive.
 * Imported across a client boundary it would serialize here as a client
 * reference, not as these values, and the script would stamp nothing at all.
 */
export function LayoutModeScript() {
  const breakpoints = JSON.stringify(layoutBreakpoints);

  // Fails the build rather than shipping a script that silently does nothing.
  if (!breakpoints.startsWith("{") || !breakpoints.includes("phone")) {
    throw new Error(
      `LayoutModeScript could not serialize layoutBreakpoints (got ${breakpoints}). ` +
        "It must be imported from a module without a \"use client\" directive."
    );
  }

  const source = `(function(){try{
var b=${breakpoints};
var w=window.innerWidth;
var r=document.documentElement;
r.dataset.layoutMode=w<b.phone?"phone":w<b.desktop?"compact":"desktop";
r.dataset.figureArrangement=String(w>=b.figure);
r.dataset.wideFocusRail=String(w>=b.wideFocusRail);
r.style.setProperty("--layout-phone-breakpoint",b.phone+"px");
r.style.setProperty("--layout-figure-breakpoint",b.figure+"px");
r.style.setProperty("--layout-desktop-breakpoint",b.desktop+"px");
r.style.setProperty("--layout-wide-focus-breakpoint",b.wideFocusRail+"px");
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
