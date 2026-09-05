import { calendarFor, systemClock } from "@/shared/kernel/calendar";

// Server composition root. Configure TZ before startup, as the test scripts do.
export const clock = systemClock;
export const calendar = calendarFor(Intl.DateTimeFormat().resolvedOptions().timeZone);
