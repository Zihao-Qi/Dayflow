"use client";

import { PausedFocusRing } from "./focus-ring";

import { Play } from "lucide-react";
import { useFocusSession } from "@/components/focus-session-provider";
import {
  type FocusSessionRecord,
  focusRemainingSeconds,
  focusElapsedSeconds
} from "@/lib/focus-domain";

export function PausedFocusCard({
  session,
  now,
  busy
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
}) {
  const { transition } = useFocusSession();
  const elapsed = focusElapsedSeconds(session, now);
  const remaining = focusRemainingSeconds(session, now);
  const elapsedMinutes = Math.floor(elapsed / 60);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  const pausedSeconds = session.pausedAt
    ? Math.max(0, Math.floor((now - new Date(session.pausedAt).getTime()) / 1000))
    : 0;
  const pausedFor =
    pausedSeconds < 60
      ? "just now"
      : pausedSeconds < 3600
        ? `${Math.floor(pausedSeconds / 60)} ${Math.floor(pausedSeconds / 60) === 1 ? "minute" : "minutes"} ago`
        : pausedSeconds < 86400
          ? `${Math.floor(pausedSeconds / 3600)} ${Math.floor(pausedSeconds / 3600) === 1 ? "hour" : "hours"} ago`
          : `${Math.floor(pausedSeconds / 86400)} ${Math.floor(pausedSeconds / 86400) === 1 ? "day" : "days"} ago`;
  const title = session.task?.title ?? session.label;

  return (
    <>
      <section className="rail-card paused-focus-card">
        <PausedFocusRing session={session} remaining={remaining} progress={progress} />
        <h3>{title}</h3>
        <p>
          Paused {pausedFor}. Nothing is being recorded.
        </p>
        <div className="rail-focus-controls">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void transition("resume")}
          >
            <Play size={14} />
            Resume
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void transition("complete")}
          >
            Finish {elapsedMinutes}m
          </button>
        </div>
        <button
          className="text-button rail-cancel"
          disabled={busy}
          onClick={() => {
            if (
              elapsedMinutes < 1 ||
              window.confirm(
                `Cancel this focus block? ${elapsedMinutes}m of focus will not be recorded.`
              )
            ) {
              void transition("cancel");
            }
          }}
        >
          Cancel
        </button>
      </section>
      <section className="rail-card paused-recorded-card">
        <span className="eyebrow">Already recorded</span>
        <p>
          {elapsedMinutes}m of this block is safe. Finishing now keeps it.
        </p>
      </section>
    </>
  );
}
