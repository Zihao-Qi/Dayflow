"use client";

import { useEffect, useState } from "react";
import type { ProjectSummary } from "@/lib/project-domain";
import type { BacklogArrange, Task } from "@/modules/planning/ui/backlog-model";

/** The already-derived bootstrap slice shared with Today and navigation counts. */
export type BacklogBootstrapSlice = {
  tasks: Task[];
  projects: Map<string, ProjectSummary>;
  today: string;
};

export type BacklogPageData = BacklogBootstrapSlice & {
  figureArrangement: boolean;
  arrangement: BacklogArrange;
  onArrangementChange: (arrangement: BacklogArrange) => void;
  scopeProjectId: string | null;
  onClearScope: () => void;
};

export type BacklogPageState = {
  setArrangement: (arrangement: BacklogArrange) => void;
  setScopeProjectId: (id: string | null) => void;
  page: BacklogPageData | null;
};

/**
 * Called by Dashboard so arrangement and scope survive destination navigation,
 * and the narrow-viewport fallback still runs while Backlog is unmounted.
 */
export function useBacklogPage(
  figureArrangement: boolean,
  bootstrap: BacklogBootstrapSlice | null
): BacklogPageState {
  const [backlogArrange, setBacklogArrange] =
    useState<BacklogArrange>("quadrant");
  const [backlogScopeProjectId, setBacklogScopeProjectId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!figureArrangement) {
      setBacklogArrange((current) =>
        current === "figure" ? "quadrant" : current
      );
    }
  }, [figureArrangement]);

  return {
    setArrangement: setBacklogArrange,
    setScopeProjectId: setBacklogScopeProjectId,
    page: bootstrap
      ? {
          ...bootstrap,
          figureArrangement,
          arrangement: backlogArrange,
          onArrangementChange: setBacklogArrange,
          scopeProjectId: backlogScopeProjectId,
          onClearScope: () => setBacklogScopeProjectId(null)
        }
      : null
  };
}
