"use client";

import { Check } from "lucide-react";
import { type FocusSessionRecord, formatFocusClock } from "@/lib/focus-domain";

export function RunningFocusRing({
  session,
  remaining,
  progress
}: {
  session: FocusSessionRecord;
  remaining: number;
  progress: number;
}) {
  return (
    <div
      className="rail-focus-clock"
      style={{
        background: `conic-gradient(var(--sage) ${progress}%, #e2e0d5 ${progress}% 100%)`
      }}
      aria-label={`${formatFocusClock(remaining)} remaining`}
    >
      <div>
        <strong>{formatFocusClock(remaining)}</strong>
        <span>
          {session.status === "PAUSED"
            ? "Paused"
            : session.kind === "BREAK"
              ? "Break"
              : `Focus · ${session.plannedMinutes}m`}
        </span>
      </div>
    </div>
  );
}

export function PausedFocusRing({
  session,
  remaining,
  progress
}: {
  session: FocusSessionRecord;
  remaining: number;
  progress: number;
}) {
  return (
    <div
      className="rail-focus-clock"
      style={{
        background: `conic-gradient(#c9a882 ${progress}%, #e6ddcb ${progress}% 100%)`
      }}
      aria-label={`${formatFocusClock(remaining)} remaining while paused`}
    >
      <div>
        <strong>{formatFocusClock(remaining)}</strong>
        <span>Paused · {session.plannedMinutes}m</span>
      </div>
    </div>
  );
}

export function BreakFocusRing({
  session,
  remaining,
  progress
}: {
  session: FocusSessionRecord;
  remaining: number;
  progress: number;
}) {
  return (
    <div
      className="rail-focus-clock"
      style={{
        background: `conic-gradient(var(--clay) ${progress}%, #e6ddcb ${progress}% 100%)`
      }}
    >
      <div>
        <strong>{formatFocusClock(remaining)}</strong>
        <span>{session.plannedMinutes}m</span>
      </div>
    </div>
  );
}

export function StripFocusRing({
  completionPending,
  isBreak,
  isPaused,
  progress,
  remaining,
  onExpand
}: {
  completionPending: boolean;
  isBreak: boolean;
  isPaused: boolean;
  progress: number;
  remaining: number;
  onExpand?: () => void;
}) {
  return (
    <button
      className="focus-strip-ring"
      title="Expand focus rail"
      onClick={onExpand}
      style={{
        background: completionPending
          ? "var(--sage)"
          : `conic-gradient(${isBreak || isPaused ? "#c9a882" : "var(--sage)"} ${progress}%, ${isBreak || isPaused ? "#e6ddcb" : "#e2e0d5"} ${progress}% 100%)`
      }}
    >
      <span>
        {completionPending ? <Check size={16} /> : formatFocusClock(remaining)}
      </span>
    </button>
  );
}
