"use client";

import type { ProjectSummary } from "@/lib/project-domain";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { FocusDraft } from "@/lib/focus-draft";
export type { FocusDraft } from "@/lib/focus-draft";

export type FocusTask = {
  id: string;
  title: string;
  projectId: string | null;
  date: string | null;
  estimateMinutes?: number;
  sortOrder?: number;
  focusQueuePosition?: number | null;
};

export type CapturedActivity = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
};

export type FocusRailProps = {
  tasks: FocusTask[];
  projects: ProjectSummary[];
  today: string;
  draft: FocusDraft | null;
  activities: CapturedActivity[];
  queuedTasks?: FocusTask[];
  mode: "full" | "strip";
  collapsible?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onOpenPalette?: () => void;
  onQueueTask?: (taskId: string, placement: QueuePlacement) => Promise<boolean>;
  onRemoveQueuedTask?: (taskId: string) => Promise<boolean>;
  onReorderQueue?: (ids: string[], announcement: string) => Promise<boolean>;
  onQueueChanged?: () => Promise<void>;
  onAnnounce?: (message: string) => void;
};

export type FocusQueueEntry =
  | {
      id: "__focus_break__";
      kind: "break";
      title: "Break — stand up";
      durationMinutes: number;
    }
  | {
      id: string;
      kind: "task";
      title: string;
      durationMinutes: number;
      task: FocusTask;
    };
