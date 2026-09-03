"use client";

import { useEffect, useState } from "react";

export type LayoutMode = "phone" | "compact" | "desktop";

export const layoutBreakpoints = {
  phone: 620,
  // Chrome changes at 1180 because the sidebar and rail no longer fit; Figure
  // changes at 700 because its data no longer fits. Those constraints cannot
  // share a breakpoint.
  figure: 700,
  desktop: 1180,
  wideFocusRail: 1400
} as const;

type LayoutState = {
  mode: LayoutMode;
  figureArrangement: boolean;
  wideFocusRail: boolean;
};

let resizeClassTimer: number | null = null;

function readLayoutState(): LayoutState {
  if (typeof window === "undefined") {
    return {
      mode: "desktop",
      figureArrangement: true,
      wideFocusRail: false
    };
  }

  const width = window.innerWidth;
  return {
    mode:
      width < layoutBreakpoints.phone
        ? "phone"
        : width < layoutBreakpoints.desktop
          ? "compact"
          : "desktop",
    figureArrangement: width >= layoutBreakpoints.figure,
    wideFocusRail: width >= layoutBreakpoints.wideFocusRail
  };
}

function applyDocumentLayout(state: LayoutState) {
  const root = document.documentElement;
  root.dataset.layoutMode = state.mode;
  root.dataset.figureArrangement = String(state.figureArrangement);
  root.dataset.wideFocusRail = String(state.wideFocusRail);
  root.style.setProperty(
    "--layout-phone-breakpoint",
    `${layoutBreakpoints.phone}px`
  );
  root.style.setProperty(
    "--layout-figure-breakpoint",
    `${layoutBreakpoints.figure}px`
  );
  root.style.setProperty(
    "--layout-desktop-breakpoint",
    `${layoutBreakpoints.desktop}px`
  );
  root.style.setProperty(
    "--layout-wide-focus-breakpoint",
    `${layoutBreakpoints.wideFocusRail}px`
  );
}

function captureScrollPosition() {
  const scrollingElement = document.scrollingElement;
  const workspace = document.querySelector<HTMLElement>(".workspace");
  return {
    documentLeft: scrollingElement?.scrollLeft ?? window.scrollX,
    documentTop: scrollingElement?.scrollTop ?? window.scrollY,
    workspaceLeft: workspace?.scrollLeft ?? 0,
    workspaceTop: workspace?.scrollTop ?? 0
  };
}

function restoreScrollPosition(position: ReturnType<typeof captureScrollPosition>) {
  const restore = () => {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (workspace) {
      workspace.scrollLeft = position.workspaceLeft;
      workspace.scrollTop = position.workspaceTop;
    }
    window.scrollTo(position.documentLeft, position.documentTop);
  };

  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

export function markDocumentResizing() {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.add("resizing");
  if (resizeClassTimer !== null) window.clearTimeout(resizeClassTimer);
  resizeClassTimer = window.setTimeout(() => {
    root.classList.remove("resizing");
    resizeClassTimer = null;
  }, 150);
}

export function useLayoutMode() {
  const [layout, setLayout] = useState<LayoutState>(() => readLayoutState());

  useEffect(() => {
    let current = readLayoutState();
    applyDocumentLayout(current);
    setLayout(current);

    function handleResize() {
      markDocumentResizing();
      const next = readLayoutState();
      if (
        next.mode === current.mode &&
        next.figureArrangement === current.figureArrangement &&
        next.wideFocusRail === current.wideFocusRail
      ) {
        return;
      }

      const scrollPosition = captureScrollPosition();
      current = next;
      applyDocumentLayout(next);
      setLayout(next);
      restoreScrollPosition(scrollPosition);
    }

    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return layout;
}
