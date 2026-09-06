"use client";

import { StripFocusRing } from "./focus-ring";

import { Check, ChevronDown, Pause, Play } from "lucide-react";
import { focusRemainingSeconds, focusElapsedSeconds, formatFocusClock } from "@/lib/focus-domain";
import type { FocusTimerState } from "./use-focus-timer";
import type { FocusRailProps } from "./focus-model";

export function FocusStrip({
  active,
  pendingCompletion,
  now,
  busy,
  error,
  focus,
  onExpand
}: Pick<FocusTimerState, "active" | "pendingCompletion" | "now" | "busy" | "error" | "focus"> & Pick<FocusRailProps, "onExpand">) {
  const live = active ?? pendingCompletion;
  if (!live) return null;
  const completionPending = Boolean(pendingCompletion && !active);
  const isBreak = active?.kind === "BREAK";
  const isPaused = active?.status === "PAUSED";
  const remaining = active ? focusRemainingSeconds(active, now) : 0;
  const elapsed = active ? focusElapsedSeconds(active, now) : 0;
  const progress = active
    ? Math.min(100, (elapsed / (active.plannedMinutes * 60)) * 100)
    : 100;
  return (
    <aside
      className={`focus-strip ${isBreak ? "break" : ""} ${isPaused ? "paused" : ""} ${completionPending ? "complete" : ""}`}
      aria-label={completionPending ? "Completed focus session" : "Active focus session"}
    >
      <StripFocusRing
        completionPending={completionPending}
        isBreak={isBreak}
        isPaused={isPaused}
        progress={progress}
        remaining={remaining}
        onExpand={onExpand}
      />
      <button className="focus-strip-mobile-copy" onClick={onExpand}>
        <strong>{live.task?.title ?? live.label}</strong>
        <span>
          {completionPending
            ? `${live.actualMinutes}m counted · add optional details`
            : isBreak
              ? `Break · ${formatFocusClock(remaining)} left`
              : isPaused
                ? `Paused · ${formatFocusClock(remaining)} left`
              : `Focusing · ${formatFocusClock(remaining)} left`}
        </span>
      </button>
      <span className="focus-strip-label">
        {completionPending ? "Done" : isBreak ? "Break" : isPaused ? "Paused" : "Focus"}
      </span>
      {!completionPending && active && (
        <>
          <button
            className="focus-strip-action"
            title={active.status === "PAUSED" ? "Resume timer" : "Pause timer"}
            aria-label={active.status === "PAUSED" ? "Resume timer" : "Pause timer"}
            disabled={busy}
            onClick={() =>
              void focus.transition(active.status === "PAUSED" ? "resume" : "pause")
            }
          >
            {active.status === "PAUSED" ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            className="focus-strip-action finish"
            title={isBreak ? "End break" : "Finish timer"}
            aria-label={isBreak ? "End break" : "Finish timer"}
            disabled={busy}
            onClick={() => void focus.transition("complete")}
          >
            <Check size={15} />
          </button>
        </>
      )}
      {completionPending && (
        <button
          className="focus-strip-action finish"
          title="Add focus details"
          aria-label="Add focus details"
          onClick={onExpand}
        >
          <Check size={15} />
        </button>
      )}
      <button
        className="focus-strip-expand"
        title="Expand focus rail"
        aria-label="Expand focus rail"
        onClick={onExpand}
      >
        <ChevronDown size={16} />
      </button>
      {error && <span className="sr-only">{error}</span>}
    </aside>
  );

}
