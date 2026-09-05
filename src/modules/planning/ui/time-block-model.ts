import { localDateKey, parseLocalDate } from "@/lib/dates";
import {
  parseTimeBlockPathId,
  parseTimeBlockTaskId,
  parseTimeBlockTime,
  TIME_BLOCK_TITLE_MAX_LENGTH,
  timeBlockTimeToMinutes,
  type TimeBlockRecord
} from "@/lib/time-blocks";

export function isTimeBlockRecord(value: unknown): value is TimeBlockRecord {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<TimeBlockRecord>;
  try {
    const parsedDate = parseLocalDate(block.date);
    const canonicalId =
      typeof block.id === "string" ? parseTimeBlockPathId(block.id) : null;
    const canonicalTaskId =
      block.taskId === null
        ? null
        : parseTimeBlockTaskId(block.taskId);
    const startTime = parseTimeBlockTime(block.startTime, "startTime");
    const endTime = parseTimeBlockTime(block.endTime, "endTime");
    if (
      canonicalId !== block.id ||
      !parsedDate ||
      localDateKey(parsedDate) !== block.date ||
      startTime !== block.startTime ||
      endTime !== block.endTime ||
      timeBlockTimeToMinutes(startTime) >= timeBlockTimeToMinutes(endTime) ||
      typeof block.title !== "string" ||
      !block.title ||
      block.title.trim() !== block.title ||
      block.title.length > TIME_BLOCK_TITLE_MAX_LENGTH ||
      canonicalTaskId !== block.taskId ||
      typeof block.createdAt !== "string" ||
      !isCanonicalIsoDate(block.createdAt)
    ) {
      return false;
    }

    if (block.task === null) return block.taskId === null;
    if (!block.task || typeof block.task !== "object") return false;
    return (
      block.taskId !== null &&
      block.task.id === block.taskId &&
      parseTimeBlockPathId(block.task.id) === block.task.id &&
      typeof block.task.title === "string" &&
      Boolean(block.task.title.trim()) &&
      Number.isInteger(block.task.estimateMinutes) &&
      block.task.estimateMinutes >= 0
    );
  } catch {
    return false;
  }
}

export function isCanonicalIsoDate(value: string) {
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value
  );
}
