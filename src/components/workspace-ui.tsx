"use client";

import type { ReactNode } from "react";
import type { FocusSessionRecord } from "@/lib/focus-domain";
import {
  focusElapsedSeconds,
  focusRemainingSeconds,
  formatFocusClock
} from "@/lib/focus-domain";

export function PageHeader({
  eyebrow,
  title,
  actions
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {actions}
    </header>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control">
      {options.map(([id, label]) => (
        <button
          key={id}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function MiniFocusRing({
  session,
  now
}: {
  session: FocusSessionRecord;
  now: number;
}) {
  const elapsed = focusElapsedSeconds(session, now);
  const progress = Math.min(
    100,
    (elapsed / (session.plannedMinutes * 60)) * 100
  );
  return (
    <div
      className="mini-focus-ring"
      style={{
        background: `conic-gradient(var(--sage) ${progress}%, #e2e0d5 ${progress}% 100%)`
      }}
    >
      <span>{formatFocusClock(focusRemainingSeconds(session, now))}</span>
    </div>
  );
}
