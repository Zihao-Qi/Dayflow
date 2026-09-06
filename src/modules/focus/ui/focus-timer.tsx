"use client";

import { useFocusSession } from "@/components/focus-session-provider";
import type { ProjectSummary } from "@/lib/project-domain";
import { FocusRail } from "./focus-rail";
import type { FocusTask, FocusDraft } from "./focus-model";

/**
 * Kept as a compatibility wrapper for consumers that previously mounted the timer
 * as a panel. The redesigned app shell mounts FocusRail instead.
 */
export function FocusTimer({
  tasks,
  projects,
  today,
  draft
}: {
  tasks: FocusTask[];
  projects: ProjectSummary[];
  today: string;
  draft: FocusDraft | null;
}) {
  return (
    <FocusRail
      tasks={tasks}
      projects={projects}
      today={today}
      draft={draft}
      activities={[]}
      mode="full"
    />
  );
}

export function FocusSessionBanner({ onOpenToday }: { onOpenToday: () => void }) {
  const { active } = useFocusSession();
  if (!active) return null;
  return (
    <FocusRail
      tasks={[]}
      projects={[]}
      today={new Date().toISOString()}
      draft={null}
      activities={[]}
      mode="strip"
      onExpand={onOpenToday}
    />
  );
}
