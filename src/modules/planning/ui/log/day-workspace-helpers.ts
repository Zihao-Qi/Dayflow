import type { FocusSessionRecord } from "@/lib/focus-domain";
import { focusElapsedSeconds } from "@/lib/focus-domain";
import {
  timeBlockDurationMinutes,
  timeBlockTimeToMinutes,
  type TimeBlockRecord
} from "@/lib/time-blocks";

const TIMELINE_BASE_HOUR_HEIGHT_PX = 52;
const TIMELINE_DESKTOP_TARGET_HEIGHT_PX = 24;
const TIMELINE_TOUCH_TARGET_HEIGHT_PX = 44;

type TimelineActivity = {
  startedAt: string;
  durationMinutes: number;
};

export function timelineBounds(
  blocks: TimeBlockRecord[],
  activities: TimelineActivity[],
  activeFocus: FocusSessionRecord | null,
  focusNow: number
) {
  let earliestMinutes = 8 * 60;
  let latestMinutes = 18 * 60;
  for (const block of blocks) {
    const interval = safeTimeBlockInterval(block);
    if (!interval) continue;
    earliestMinutes = Math.min(earliestMinutes, interval.startMinutes);
    latestMinutes = Math.max(latestMinutes, interval.endMinutes);
  }
  for (const activity of activities) {
    const startedAt = new Date(activity.startedAt);
    const start = startedAt.getHours() * 60 + startedAt.getMinutes();
    earliestMinutes = Math.min(earliestMinutes, start);
    latestMinutes = Math.max(latestMinutes, start + activity.durationMinutes);
  }
  if (activeFocus) {
    const startedAt = new Date(activeFocus.startedAt);
    const start = startedAt.getHours() * 60 + startedAt.getMinutes();
    earliestMinutes = Math.min(earliestMinutes, start);
    latestMinutes = Math.max(
      latestMinutes,
      start + Math.max(20, focusElapsedSeconds(activeFocus, focusNow) / 60)
    );
  }
  const startHour = Math.max(
    0,
    Math.min(23, Math.floor(earliestMinutes / 60))
  );
  const endHour = Math.max(
    startHour + 1,
    Math.min(24, Math.ceil(latestMinutes / 60))
  );
  return { startHour, endHour, hourCount: endHour - startHour };
}

export function timelinePosition(
  startMinutes: number,
  durationMinutes: number,
  startHour: number,
  hourCount: number
) {
  const timelineMinutes = Math.max(60, hourCount * 60);
  const top = ((startMinutes - startHour * 60) / timelineMinutes) * 100;
  const height = (durationMinutes / timelineMinutes) * 100;
  return { top: `${top}%`, height: `${height}%` };
}

export function timelineHourHeights(blocks: TimeBlockRecord[]) {
  const shortestBlock = blocks.reduce((shortest, block) => {
    const duration = safeTimeBlockDurationMinutes(block);
    return duration > 0 ? Math.min(shortest, duration) : shortest;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(shortestBlock)) {
    return {
      desktop: TIMELINE_BASE_HOUR_HEIGHT_PX,
      touch: TIMELINE_BASE_HOUR_HEIGHT_PX
    };
  }
  return {
    desktop: Math.max(
      TIMELINE_BASE_HOUR_HEIGHT_PX,
      Math.ceil((TIMELINE_DESKTOP_TARGET_HEIGHT_PX * 60) / shortestBlock)
    ),
    touch: Math.max(
      TIMELINE_BASE_HOUR_HEIGHT_PX,
      Math.ceil((TIMELINE_TOUCH_TARGET_HEIGHT_PX * 60) / shortestBlock)
    )
  };
}

export function safeTimeBlockInterval(block: TimeBlockRecord) {
  try {
    const startMinutes = timeBlockTimeToMinutes(block.startTime);
    const endMinutes = timeBlockTimeToMinutes(block.endTime);
    return startMinutes < endMinutes
      ? { startMinutes, endMinutes }
      : null;
  } catch {
    return null;
  }
}

export function safeTimeBlockDurationMinutes(block: TimeBlockRecord) {
  try {
    return timeBlockDurationMinutes(block);
  } catch {
    return 0;
  }
}

export function formatTimelineHour(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric" });
}
