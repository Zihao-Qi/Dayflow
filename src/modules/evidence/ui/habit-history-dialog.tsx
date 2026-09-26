"use client";

import { useMemo, useRef } from "react";
import { useModalFocusTrap } from "@/components/use-modal-focus-trap";
import {
  computeDayState,
  type HabitHistoryDayState,
  type useHabitHistory
} from "./use-habit-history";
import type { HabitHistoryCheckIn, HabitHistoryDefinition } from "./history-api";
import { parseLocalDate } from "@/shared/kernel/calendar";

const DAY_STATE_LABELS: Record<HabitHistoryDayState, string> = {
  done: "Done",
  notDone: "Not done",
  unrecorded: "Not recorded",
  outOfScope: "Outside lifetime"
};

const DAY_STATE_MARKS: Record<HabitHistoryDayState, string> = {
  done: "●",
  notDone: "×",
  unrecorded: "·",
  outOfScope: " "
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type HabitHistoryDialogProps = {
  history: ReturnType<typeof useHabitHistory>;
};

export function HabitHistoryDialog({ history }: HabitHistoryDialogProps) {
  const {
    isOpen,
    requestClose,
    forceCloseAndDiscard,
    cancelDiscard,
    showDiscardConfirm,
    showArchived,
    setShowArchived,
    selectedDate,
    setSelectedDate,
    dates,
    historyData,
    activeHabits,
    archivedHabits,
    loading,
    loadError,
    refreshError,
    refreshHistory,
    editingHabitId,
    setEditingHabitId,
    getDraft,
    setDraft,
    clearDraft,
    saveCheckIn,
    reconcileRecord,
    errors,
    pendingMutations
  } = history;

  const dialogRef = useRef<HTMLElement | null>(null);
  const discardDialogRef = useRef<HTMLElement | null>(null);
  const discardKeepBtnRef = useRef<HTMLButtonElement | null>(null);

  useModalFocusTrap(dialogRef, requestClose, {
    active: isOpen && !showDiscardConfirm
  });

  useModalFocusTrap(discardDialogRef, cancelDiscard, {
    active: showDiscardConfirm,
    initialFocus: discardKeepBtnRef
  });

  const checkInsByHabitAndDay = useMemo(() => {
    const map = new Map<string, HabitHistoryCheckIn>();
    if (historyData) {
      for (const checkIn of historyData.checkIns) {
        map.set(`${checkIn.habitId}:${checkIn.day}`, checkIn);
      }
    }
    return map;
  }, [historyData]);

  if (!isOpen) return null;

  return (
    <div
      className="habit-history-dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !showDiscardConfirm) {
          requestClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="habit-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-history-heading"
        tabIndex={-1}
      >
        <div className="habit-history-header">
          <div>
            <span className="eyebrow">Backfill & review</span>
            <h2 id="habit-history-heading">Habit history</h2>
            <p className="habit-history-subtitle">
              8-day backfill window
              {historyData
                ? ` (${historyData.earliestDate} through ${historyData.latestDate})`
                : ""}
            </p>
          </div>
          <div className="habit-history-header-actions">
            <button
              type="button"
              className="text-button"
              aria-label="Refresh habit history"
              onClick={() => void refreshHistory()}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="text-button habit-history-close-btn"
              aria-label="Close habit history"
              onClick={requestClose}
            >
              Close
            </button>
          </div>
        </div>

        {refreshError && (
          <div className="habit-history-banner habit-history-banner--warning" role="alert">
            <span>{refreshError}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => void refreshHistory()}
            >
              Retry refresh
            </button>
          </div>
        )}

        {loadError && (
          <div className="habit-history-banner habit-history-banner--error" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => void refreshHistory()}
            >
              Retry
            </button>
          </div>
        )}

        <div
          className="habit-history-date-bar"
          role="region"
          aria-label="Select history date"
        >
          {dates.map((date) => {
            const isSelected = date === selectedDate;
            const isToday = date === historyData?.todayKey;
            const parsed = parseLocalDate(date);
            const weekday = parsed ? WEEKDAY_NAMES[parsed.getDay()] : "";
            const displayLabel = isToday ? "Today" : weekday;

            return (
              <button
                key={date}
                type="button"
                className={`habit-history-date-btn ${
                  isSelected ? "habit-history-date-btn--selected" : ""
                }`}
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(date)}
              >
                <span className="habit-history-date-title">{displayLabel}</span>
                <span className="habit-history-date-sub">{date.slice(5)}</span>
              </button>
            );
          })}
        </div>

        <div className="habit-history-controls">
          <label className="habit-history-archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show archived ({archivedHabits.length})</span>
          </label>
          <span className="habit-history-selected-notice">
            Viewing {selectedDate === historyData?.todayKey ? "Today, " : ""}
            {selectedDate}
          </span>
        </div>

        <div className="habit-history-list" role="region" aria-label={`Habits for ${selectedDate}`}>
          {loading && !historyData ? (
            <p className="quiet-empty">Loading habit history…</p>
          ) : activeHabits.length === 0 && (!showArchived || archivedHabits.length === 0) ? (
            <p className="quiet-empty">No habits found.</p>
          ) : (
            <>
              {activeHabits.map((habit) => (
                <HabitHistoryRow
                  key={habit.id}
                  habit={habit}
                  selectedDate={selectedDate}
                  checkIn={checkInsByHabitAndDay.get(`${habit.id}:${selectedDate}`)}
                  isEditing={editingHabitId === habit.id}
                  onStartEdit={() => setEditingHabitId(habit.id)}
                  onCancelEdit={() => {
                    clearDraft(habit.id, selectedDate);
                    setEditingHabitId(null);
                  }}
                  draft={getDraft(habit.id, selectedDate)}
                  setDraft={(updater) => setDraft(habit.id, selectedDate, updater)}
                  onSave={() => void saveCheckIn(habit.id, selectedDate)}
                  onReconcile={() => void reconcileRecord(habit.id, selectedDate)}
                  error={errors.get(`${habit.id}:${selectedDate}`)}
                  pending={pendingMutations.get(`${habit.id}:${selectedDate}`)}
                />
              ))}

              {showArchived && archivedHabits.length > 0 && (
                <div className="habit-history-archived-section">
                  <h3 className="habit-history-section-title">Archived habits</h3>
                  {archivedHabits.map((habit) => (
                    <HabitHistoryRow
                      key={habit.id}
                      habit={habit}
                      selectedDate={selectedDate}
                      checkIn={checkInsByHabitAndDay.get(`${habit.id}:${selectedDate}`)}
                      isEditing={editingHabitId === habit.id}
                      onStartEdit={() => setEditingHabitId(habit.id)}
                      onCancelEdit={() => {
                        clearDraft(habit.id, selectedDate);
                        setEditingHabitId(null);
                      }}
                      draft={getDraft(habit.id, selectedDate)}
                      setDraft={(updater) => setDraft(habit.id, selectedDate, updater)}
                      onSave={() => void saveCheckIn(habit.id, selectedDate)}
                      onReconcile={() => void reconcileRecord(habit.id, selectedDate)}
                      error={errors.get(`${habit.id}:${selectedDate}`)}
                      pending={pendingMutations.get(`${habit.id}:${selectedDate}`)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {showDiscardConfirm && (
          <div
            className="project-delete-confirm-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) cancelDiscard();
            }}
          >
            <section
              ref={discardDialogRef}
              className="project-delete-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-title"
              tabIndex={-1}
            >
              <span className="eyebrow">Unsaved changes</span>
              <h2 id="discard-title">Discard unsaved edits?</h2>
              <p>
                You have uncommitted drafts in habit history. Closing will discard
                these changes.
              </p>
              <div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={forceCloseAndDiscard}
                >
                  Discard and close
                </button>
                <button
                  ref={discardKeepBtnRef}
                  type="button"
                  className="secondary-button"
                  onClick={cancelDiscard}
                >
                  Keep editing
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function HabitHistoryRow({
  habit,
  selectedDate,
  checkIn,
  isEditing,
  onStartEdit,
  onCancelEdit,
  draft,
  setDraft,
  onSave,
  onReconcile,
  error,
  pending
}: {
  habit: HabitHistoryDefinition;
  selectedDate: string;
  checkIn?: HabitHistoryCheckIn;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  draft: ReturnType<ReturnType<typeof useHabitHistory>["getDraft"]>;
  setDraft: (
    updater: Partial<ReturnType<ReturnType<typeof useHabitHistory>["getDraft"]>>
  ) => void;
  onSave: () => void;
  onReconcile: () => void;
  error?: { message: string; field?: string };
  pending?: { mutationId: string; fingerprint: string; isUncertain: boolean; isSaving: boolean };
}) {
  const state = computeDayState(habit, selectedDate, checkIn);
  const isArchived = habit.status === "ARCHIVED";
  const isSaving = Boolean(pending?.isSaving);
  const isUncertain = Boolean(pending?.isUncertain);

  return (
    <div
      className={`habit-history-row ${isArchived ? "habit-history-row--archived" : ""}`}
      data-habit={habit.id}
      data-date={selectedDate}
    >
      <div className="habit-history-row-header">
        <div className="habit-history-row-meta">
          <span className="habit-history-habit-name">
            {habit.name}
            {isArchived && <span className="habit-history-badge">Archived</span>}
          </span>
          <span className="habit-history-cadence-label">
            {habit.cadence === "DAILY" ? "Daily" : `${habit.targetPerWeek}× per week`}
          </span>
        </div>

        <div className="habit-history-row-status-block">
          <span className={`habit-history-state-tag habit-history-state-tag--${state}`}>
            <span aria-hidden="true">{DAY_STATE_MARKS[state]}</span>
            <span>{DAY_STATE_LABELS[state]}</span>
          </span>

          {checkIn && (checkIn.amount !== null || checkIn.note) && !isEditing && (
            <div className="habit-history-recorded-details">
              {checkIn.amount !== null && (
                <span className="habit-history-detail-pill">Amount: {checkIn.amount}</span>
              )}
              {checkIn.note && (
                <span className="habit-history-detail-note" title={checkIn.note}>
                  “{checkIn.note}”
                </span>
              )}
            </div>
          )}

          {!isEditing && (
            <button
              type="button"
              className="text-button"
              aria-label={`Record or edit ${habit.name} on ${selectedDate}`}
              onClick={onStartEdit}
            >
              {checkIn ? "Edit" : "Record"}
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="habit-history-editor">
          <div className="habit-history-choice-group" role="group" aria-label={`Status for ${habit.name}`}>
            <button
              type="button"
              className={`secondary-button habit-choice-btn ${
                draft.done === true ? "habit-choice-btn--selected" : ""
              }`}
              aria-pressed={draft.done === true}
              onClick={() => setDraft({ done: true })}
              disabled={isSaving}
            >
              Done
            </button>
            <button
              type="button"
              className={`secondary-button habit-choice-btn ${
                draft.done === false ? "habit-choice-btn--selected" : ""
              }`}
              aria-pressed={draft.done === false}
              onClick={() => setDraft({ done: false })}
              disabled={isSaving}
            >
              Not done
            </button>
          </div>

          <div className="habit-history-fields-row">
            <div className="habit-history-input-wrapper">
              <input
                type="number"
                min={0}
                max={1000000}
                value={draft.amount}
                onChange={(e) => setDraft({ amount: e.target.value, touchedAmount: true })}
                placeholder="Amount (optional)"
                aria-label={`Amount for ${habit.name}`}
                disabled={isSaving}
              />
            </div>
            <div className="habit-history-input-wrapper">
              <textarea
                rows={2}
                maxLength={2000}
                value={draft.note}
                onChange={(e) => setDraft({ note: e.target.value, touchedNote: true })}
                placeholder="Note (optional)"
                aria-label={`Note for ${habit.name}`}
                disabled={isSaving}
              />
            </div>
          </div>

          {error && (
            <span className="form-error" role="alert">
              {error.message}
            </span>
          )}

          <div className="habit-history-editor-actions">
            <button
              type="button"
              className="primary-button"
              disabled={draft.done === null || isSaving}
              onClick={onSave}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isSaving}
              onClick={onCancelEdit}
            >
              Cancel
            </button>
            {isUncertain && (
              <button
                type="button"
                className="text-button"
                onClick={onReconcile}
                disabled={isSaving}
              >
                Check status
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
