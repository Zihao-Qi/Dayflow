"use client";

import type { KeyboardEvent, ReactNode } from "react";
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
  ariaLabel,
  className,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  className?: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = (index + direction + options.length) % options.length;
    const group = event.currentTarget.parentElement;
    onChange(options[nextIndex][0]);
    window.requestAnimationFrame(() => {
      group
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        [nextIndex]?.focus();
    });
  }

  return (
    <div
      className={`segmented-control${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
    >
      {options.map(([id, label], index) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          className={value === id ? "active" : ""}
          onKeyDown={(event) => moveSelection(event, index)}
          onClick={() => onChange(id)}
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
