"use client";

import { request } from "@/shared/client/api-client";
import type { HabitCadenceValue } from "@/modules/evidence/domain/habit";

export type HabitHistoryDefinition = {
  id: string;
  name: string;
  cadence: HabitCadenceValue;
  targetPerWeek: number;
  status: "ACTIVE" | "ARCHIVED";
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
  createdDay: string;
  archivedDay: string | null;
};

export type HabitHistoryCheckIn = {
  id: string;
  habitId: string;
  date: string;
  day: string;
  done: boolean;
  amount: number | null;
  note: string | null;
};

export type HabitHistoryPayload = {
  todayKey: string;
  earliestDate: string;
  latestDate: string;
  habits: HabitHistoryDefinition[];
  checkIns: HabitHistoryCheckIn[];
};

export type HabitCheckInReconciliation = {
  todayKey: string;
  earliestDate: string;
  latestDate: string;
  habitId: string;
  date: string;
  checkIn: HabitHistoryCheckIn | null;
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDayKey(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_REGEX.test(value);
}

export function isHabitHistoryDefinition(value: unknown): value is HabitHistoryDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (typeof value.name !== "string") return false;
  if (value.cadence !== "DAILY" && value.cadence !== "TIMES_PER_WEEK") return false;
  if (typeof value.targetPerWeek !== "number" || value.targetPerWeek < 1 || value.targetPerWeek > 7) return false;
  if (value.status !== "ACTIVE" && value.status !== "ARCHIVED") return false;
  if (typeof value.sortOrder !== "number") return false;
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) return false;
  if (value.archivedAt !== null && (typeof value.archivedAt !== "string" || Number.isNaN(Date.parse(value.archivedAt)))) {
    return false;
  }
  if (!isValidDayKey(value.createdDay)) return false;
  if (value.archivedDay !== null && !isValidDayKey(value.archivedDay)) return false;
  return true;
}

export function isHabitHistoryCheckIn(value: unknown): value is HabitHistoryCheckIn {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (typeof value.habitId !== "string" || !value.habitId) return false;
  if (typeof value.date !== "string" || Number.isNaN(Date.parse(value.date))) return false;
  if (!isValidDayKey(value.day)) return false;
  if (typeof value.done !== "boolean") return false;
  if (value.amount !== null && (typeof value.amount !== "number" || value.amount < 0 || !Number.isInteger(value.amount))) {
    return false;
  }
  if (value.note !== null && typeof value.note !== "string") return false;
  return true;
}

export function isHabitHistoryPayload(value: unknown): value is HabitHistoryPayload {
  if (!isRecord(value)) return false;
  if (!isValidDayKey(value.todayKey)) return false;
  if (!isValidDayKey(value.earliestDate)) return false;
  if (!isValidDayKey(value.latestDate)) return false;
  if (!Array.isArray(value.habits) || !value.habits.every(isHabitHistoryDefinition)) return false;
  if (!Array.isArray(value.checkIns) || !value.checkIns.every(isHabitHistoryCheckIn)) return false;
  return true;
}

export function isHabitCheckInReconciliation(value: unknown): value is HabitCheckInReconciliation {
  if (!isRecord(value)) return false;
  if (!isValidDayKey(value.todayKey)) return false;
  if (!isValidDayKey(value.earliestDate)) return false;
  if (!isValidDayKey(value.latestDate)) return false;
  if (typeof value.habitId !== "string" || !value.habitId) return false;
  if (!isValidDayKey(value.date)) return false;
  if (value.checkIn !== null && !isHabitHistoryCheckIn(value.checkIn)) return false;
  return true;
}

export function fetchHabitHistory(signal?: AbortSignal): Promise<HabitHistoryPayload> {
  return request("/api/habits/history", {
    method: "GET",
    signal,
    decode: isHabitHistoryPayload,
    fallback: "Habit history could not be loaded."
  });
}

export function fetchHabitCheckInDate(
  habitId: string,
  date: string,
  signal?: AbortSignal
): Promise<HabitCheckInReconciliation> {
  return request(
    `/api/habits/${encodeURIComponent(habitId)}/check-in?date=${encodeURIComponent(date)}`,
    {
      method: "GET",
      signal,
      decode: isHabitCheckInReconciliation,
      fallback: "Check-in could not be retrieved."
    }
  );
}
