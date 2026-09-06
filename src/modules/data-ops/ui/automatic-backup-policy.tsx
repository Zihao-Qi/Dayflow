"use client";

import { useEffect, useState } from "react";
import type { AutomaticBackupPolicy, AutomaticBackupState } from "@/lib/automatic-backup-contract";
import { formatDate } from "./backup-formatters";

export function AutomaticBackupPanel({
  state,
  directory,
  busy,
  disabled,
  onSave
}: {
  state: AutomaticBackupState;
  directory: string;
  busy: boolean;
  disabled: boolean;
  onSave: (policy: AutomaticBackupPolicy) => Promise<boolean>;
}) {
  const { policy, schedule, retention, lastAttempt } = state;
  // The control reflects the change immediately and reverts only if the
  // server rejects it, so the toggle never feels stuck waiting on a request.
  const [draft, setDraft] = useState(policy);
  useEffect(() => {
    setDraft(policy);
  }, [policy]);

  const save = (patch: Partial<AutomaticBackupPolicy>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void onSave(next).then((saved) => {
      if (!saved) setDraft(policy);
    });
  };

  return (
    <section
      className="automatic-backup-panel panel"
      aria-labelledby="automatic-backup-title"
    >
      <div className="automatic-backup-heading">
        <div>
          <span className="eyebrow">Unattended protection</span>
          <strong id="automatic-backup-title">Automatic backups</strong>
        </div>
        <label className="automatic-backup-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={disabled}
            onChange={(event) => save({ enabled: event.target.checked })}
          />
          <span>{draft.enabled ? "On" : "Off"}</span>
        </label>
      </div>

      <p className="automatic-backup-copy">
        Dayflow creates a verified backup on its own schedule while it is
        running. It never deletes a backup — removing old copies stays your
        choice.
      </p>

      <div className="automatic-backup-fields">
        <label htmlFor="automatic-backup-interval">
          <span>Every</span>
          <select
            id="automatic-backup-interval"
            value={draft.intervalHours}
            disabled={disabled || !draft.enabled}
            onChange={(event) =>
              save({ intervalHours: Number(event.target.value) })
            }
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>day</option>
            <option value={72}>3 days</option>
            <option value={168}>week</option>
          </select>
        </label>
        <label htmlFor="automatic-backup-retain">
          <span>Keep</span>
          <input
            id="automatic-backup-retain"
            type="number"
            min={1}
            max={50}
            step={1}
            value={draft.retainCount}
            disabled={disabled || !draft.enabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= 50) {
                save({ retainCount: next });
              }
            }}
          />
        </label>
      </div>

      <dl className="automatic-backup-facts">
        <div>
          <dt>Last automatic backup</dt>
          <dd>
            {state.lastSuccessAt ? formatDate(state.lastSuccessAt) : "None yet"}
          </dd>
        </div>
        <div>
          <dt>Next due</dt>
          <dd>
            {!draft.enabled
              ? "Not scheduled"
              : schedule.due
                ? "As soon as Dayflow checks"
                : formatDate(schedule.nextDueAt)}
          </dd>
        </div>
        <div>
          <dt>Automatic copies kept</dt>
          <dd>{retention.automaticCount}</dd>
        </div>
      </dl>

      {lastAttempt?.status === "failed" && (
        <p className="automatic-backup-failure" role="status">
          The last automatic backup did not complete
          {lastAttempt.reason ? `: ${lastAttempt.reason}` : "."} Dayflow will
          try again at the next check.
        </p>
      )}

      {retention.beyondRetention > 0 && (
        <p className="automatic-backup-retention" role="status">
          <strong>
            {retention.beyondRetention} automatic{" "}
            {retention.beyondRetention === 1 ? "copy is" : "copies are"} beyond
            the {retention.retainCount} you asked to keep.
          </strong>{" "}
          Dayflow has not deleted anything. Remove copies yourself in{" "}
          <code>{directory}</code> when you want the space back.
        </p>
      )}

      {busy && (
        <p className="automatic-backup-copy" role="status">
          Saving automatic backup settings…
        </p>
      )}
    </section>
  );
}
