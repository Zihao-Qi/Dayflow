import { layoutBreakpoints } from "@/components/use-layout-mode";

/**
 * Dayflow's responsive rules key off `data-layout-mode` on the root element
 * rather than media queries, and that attribute is normally stamped by
 * `useLayoutMode` from an effect. The server cannot know the viewport width,
 * so without this a phone paints the desktop chrome for one frame and then
 * snaps.
 *
 * This runs synchronously before first paint and stamps the same attributes
 * `useLayoutMode` would, from the same breakpoints, so the first frame is
 * already correct. It only touches `documentElement`, never React-rendered
 * DOM, so it cannot cause a hydration mismatch.
 */
export function LayoutModeScript() {
  const source = `(function(){try{
var b=${JSON.stringify(layoutBreakpoints)};
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
