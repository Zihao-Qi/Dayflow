// Compatibility surface; arithmetic lives in the pure shared kernel.
export {
  startOfLocalDay,
  parseLocalDate,
  addDays,
  dateKey,
  localDateKey,
  sameDayRange,
  reviewPeriodRange,
  millisecondsUntilNextLocalDay
} from "@/shared/kernel/calendar";
