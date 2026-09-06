"use client";

import type { ActivityEntry } from "@/components/activity-records";
import type { useFocusSession } from "@/components/focus-session-provider";
import type { LayoutMode } from "@/components/use-layout-mode";
import type { ProjectSummary } from "@/lib/project-domain";
import type { Task } from "@/modules/planning/ui/backlog-model";

/** The already-derived bootstrap slice shared with Log, capture and navigation. */
export type TodayBootstrapSlice = {
  today: string;
  tasks: Task[];
  backlogTasks: Task[];
  unfinishedTasks: Task[];
  projects: ProjectSummary[];
  projectById: Map<string, ProjectSummary>;
  activities: ActivityEntry[];
};

type TodayLiveData = {
  layoutMode: LayoutMode;
  focusedMinutes: number;
  activeFocus: ReturnType<typeof useFocusSession>["active"];
  focusNow: number;
  focusBusy: boolean;
};

export type TodayPageData = TodayBootstrapSlice & TodayLiveData & {
  plannedMinutes: number;
};

export type TodayPageState = {
  page: TodayPageData | null;
};

/**
 * Called by Dashboard to compose page data. Drafts, dismissal state and mutation
 * handlers retain shell ownership; reorder and Later state retain page lifetime.
 */
export function useTodayPage(
  bootstrap: TodayBootstrapSlice | null,
  live: TodayLiveData,
  dismissedUnfinished: string[]
): TodayPageState {
  const visibleUnfinished = (bootstrap?.unfinishedTasks ?? []).filter(
    (task) => !dismissedUnfinished.includes(task.id)
  );
  const plannedMinutes = (bootstrap?.tasks ?? []).reduce(
    (sum, task) => sum + task.estimateMinutes,
    0
  );

  return {
    page: bootstrap
      ? {
          ...bootstrap,
          ...live,
          unfinishedTasks: visibleUnfinished,
          plannedMinutes
        }
      : null
  };
}
