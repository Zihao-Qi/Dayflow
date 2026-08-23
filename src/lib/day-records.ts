import { isTimeBlockRecord, type TimeBlockRecord } from "@/lib/time-blocks";

export type ViewedDayKind = "past" | "today" | "future";

export type ViewedDayTask = {
  id: string;
  title: string;
  date: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
};

export type ViewedDayActivity = {
  id: string;
  startedAt: string;
  durationMinutes: number;
};

export type ViewedDayPayload = {
  dateKey: string;
  kind: ViewedDayKind;
  tasks: ViewedDayTask[];
  timeBlocks: TimeBlockRecord[];
  activities: ViewedDayActivity[];
  earliestDayKey: string | null;
  forwardWeeks: number;
};

const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime());

function isTask(value: unknown): value is ViewedDayTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "string" &&
    task.id.length > 0 &&
    typeof task.title === "string" &&
    (task.date === null || isIsoTimestamp(task.date)) &&
    (task.status === "TODO" ||
      task.status === "IN_PROGRESS" ||
      task.status === "DONE")
  );
}

function isActivity(value: unknown): value is ViewedDayActivity {
  if (!value || typeof value !== "object") return false;
  const activity = value as Record<string, unknown>;
  return (
    typeof activity.id === "string" &&
    activity.id.length > 0 &&
    isIsoTimestamp(activity.startedAt) &&
    Number.isInteger(activity.durationMinutes) &&
    Number(activity.durationMinutes) >= 0
  );
}

export function isViewedDayPayload(value: unknown): value is ViewedDayPayload {
  if (!value || typeof value !== "object") return false;
  const day = value as Record<string, unknown>;
  return (
    isDayKey(day.dateKey) &&
    (day.kind === "past" || day.kind === "today" || day.kind === "future") &&
    Array.isArray(day.tasks) &&
    day.tasks.every(isTask) &&
    Array.isArray(day.timeBlocks) &&
    day.timeBlocks.every(isTimeBlockRecord) &&
    Array.isArray(day.activities) &&
    day.activities.every(isActivity) &&
    // A future day must never carry Activity, whatever the server sent. The
    // client refuses to render invented evidence rather than trusting the
    // route to have excluded it.
    (day.kind !== "future" || day.activities.length === 0) &&
    (day.earliestDayKey === null || isDayKey(day.earliestDayKey)) &&
    Number.isInteger(day.forwardWeeks) &&
    Number(day.forwardWeeks) > 0
  );
}
