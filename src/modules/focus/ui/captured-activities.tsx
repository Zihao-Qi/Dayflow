"use client";

import type { FocusRailProps } from "./focus-model";

export function CapturedActivities({
  activities,
  onOpenPalette
}: Pick<FocusRailProps,
  "activities" | "onOpenPalette"
>) {
  return (
    <section className="rail-card captured-card">
      <div className="captured-heading">
        <span className="eyebrow">Captured today</span>
        <strong>
          {activities.reduce((sum, activity) => sum + activity.durationMinutes, 0)}m
        </strong>
      </div>
      <div className="captured-list">
        {activities.slice(0, 4).map((activity) => (
          <div key={activity.id}>
            <time>
              {new Date(activity.startedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit"
              })}
            </time>
            <span>
              <strong>{activity.note}</strong>
              <small>
                {activity.durationMinutes}m · {activity.category}
              </small>
            </span>
          </div>
        ))}
        {!activities.length && (
          <p>No activity recorded yet. Your completed focus sessions will appear here.</p>
        )}
      </div>
      <button className="rail-link" onClick={onOpenPalette}>
        Log something by hand
      </button>
    </section>
  );
}
