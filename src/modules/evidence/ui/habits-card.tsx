"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CheckInDayState,
  HabitCadenceValue,
  HabitSummary
} from "@/modules/evidence/domain/habit";
import { useModalFocusTrap } from "@/components/use-modal-focus-trap";

/**
 * Built from the classes Today already uses, so a restyle of the page carries
 * this card with it rather than leaving it behind.
 */

const DAY_LABEL: Record<CheckInDayState, string> = {
  done: "done",
  notDone: "not done",
  unrecorded: "not recorded",
  // Covers days that have not happened, days before the Habit existed and days
  // after it was archived; "outside this period" described only the first.
  outOfScope: "not tracked"
};

// State is carried by text, never by colour alone.
const DAY_MARK: Record<CheckInDayState, string> = {
  done: "●",
  notDone: "×",
  unrecorded: "·",
  outOfScope: " "
};

export function HabitsCard({
  habits,
  todayKey,
  onRecord,
  onCreate,
  onRename,
  onArchive,
  onReorder,
  busyHabitIds,
  createPending,
  reorderPending
}: {
  habits: HabitSummary[];
  todayKey: string;
  onRecord: (
    habitId: string,
    done: boolean,
    details?: { amount?: number | null; note?: string | null }
  ) => Promise<{ ok: boolean; error?: string; field?: string }>;
  onCreate: (
    name: string,
    cadence?: HabitCadenceValue,
    targetPerWeek?: number
  ) => Promise<boolean>;
  onRename: (
    habitId: string,
    name: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onArchive: (habitId: string) => Promise<boolean>;
  onReorder?: (habitId: string, direction: "up" | "down") => Promise<boolean>;
  busyHabitIds: ReadonlySet<string>;
  createPending: boolean;
  reorderPending?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [cadence, setCadence] = useState<HabitCadenceValue>("DAILY");
  const [targetPerWeek, setTargetPerWeek] = useState(3);
  const trimmed = draft.trim();

  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [submittingRenameHabitId, setSubmittingRenameHabitId] = useState<string | null>(null);

  const renameOpRef = useRef(0);
  const editingHabitIdRef = useRef<string | null>(null);
  editingHabitIdRef.current = editingHabitId;

  const [archivingHabit, setArchivingHabit] = useState<HabitSummary | null>(null);
  const [archiving, setArchiving] = useState(false);
  const archiveDialogRef = useRef<HTMLElement | null>(null);
  const keepHabitRef = useRef<HTMLButtonElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  const returnFocusHabitIdRef = useRef<string | null>(null);
  const renameButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const habitToggleRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const moveUpButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const moveDownButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const focusTargetRef = useRef<{
    habitId: string;
    preferredDirection: "up" | "down";
  } | null>(null);

  useEffect(() => {
    if (editingHabitId === null && returnFocusHabitIdRef.current) {
      const habitId = returnFocusHabitIdRef.current;
      returnFocusHabitIdRef.current = null;
      const button =
        renameButtonRefs.current.get(habitId) ??
        habitToggleRefs.current.get(habitId);
      button?.focus();
    }
  }, [editingHabitId]);

  useEffect(() => {
    if (reorderPending || !focusTargetRef.current) return;
    const { habitId, preferredDirection } = focusTargetRef.current;
    focusTargetRef.current = null;
    const index = habits.findIndex((h) => h.id === habitId);
    if (index < 0) return;
    const moveUpBtn = moveUpButtonRefs.current.get(habitId);
    const moveDownBtn = moveDownButtonRefs.current.get(habitId);
    if (preferredDirection === "up") {
      if (moveUpBtn && !moveUpBtn.disabled) {
        moveUpBtn.focus();
      } else if (moveDownBtn && !moveDownBtn.disabled) {
        moveDownBtn.focus();
      } else {
        const toggle = habitToggleRefs.current.get(habitId);
        toggle?.focus();
      }
    } else {
      if (moveDownBtn && !moveDownBtn.disabled) {
        moveDownBtn.focus();
      } else if (moveUpBtn && !moveUpBtn.disabled) {
        moveUpBtn.focus();
      } else {
        const toggle = habitToggleRefs.current.get(habitId);
        toggle?.focus();
      }
    }
  }, [habits, reorderPending]);

  async function handleReorder(habitId: string, direction: "up" | "down") {
    if (!onReorder || reorderPending) return;
    focusTargetRef.current = { habitId, preferredDirection: direction };
    try {
      const ok = await onReorder(habitId, direction);
      if (!ok) {
        focusTargetRef.current = null;
      }
    } catch {
      focusTargetRef.current = null;
    }
  }

  useModalFocusTrap(
    archiveDialogRef,
    archiving ? null : () => setArchivingHabit(null),
    {
      active: Boolean(archivingHabit),
      initialFocus: keepHabitRef
    }
  );

  function startRename(habitId: string, currentName: string) {
    renameOpRef.current++;
    returnFocusHabitIdRef.current = habitId;
    setEditingHabitId(habitId);
    setRenameDraft(currentName);
    setRenameError("");
  }

  function cancelRename() {
    renameOpRef.current++;
    setEditingHabitId(null);
    setRenameDraft("");
    setRenameError("");
  }

  async function handleRenameSubmit(habitId: string) {
    const opToken = ++renameOpRef.current;
    setSubmittingRenameHabitId(habitId);
    try {
      const res = await onRename(habitId, renameDraft);
      // If user switched editor or started another rename operation, do not settle into current editor
      if (renameOpRef.current !== opToken || editingHabitIdRef.current !== habitId) {
        return;
      }
      if (res.ok) {
        setEditingHabitId(null);
        setRenameDraft("");
        setRenameError("");
      } else {
        setRenameError(res.error ?? "Habit could not be renamed.");
      }
    } catch (error) {
      if (renameOpRef.current !== opToken || editingHabitIdRef.current !== habitId) {
        return;
      }
      setRenameError(
        error instanceof Error ? error.message : "Habit could not be renamed."
      );
    } finally {
      setSubmittingRenameHabitId((curr) => (curr === habitId ? null : curr));
    }
  }

  async function handleArchiveConfirm() {
    if (!archivingHabit) return;
    setArchiving(true);
    const habitIndex = habits.findIndex((h) => h.id === archivingHabit.id);
    const nextTarget =
      habits[habitIndex + 1] ?? habits[habitIndex - 1] ?? null;
    const nextTargetId = nextTarget?.id ?? null;

    try {
      const ok = await onArchive(archivingHabit.id);
      if (ok) {
        setArchivingHabit(null);
        // Move focus to a stable target: next Habit's toggle, else previous, else the "New habit name" input
        requestAnimationFrame(() => {
          if (nextTargetId) {
            const nextBtn = habitToggleRefs.current.get(nextTargetId);
            if (nextBtn && nextBtn.isConnected) {
              nextBtn.focus();
              return;
            }
          }
          createInputRef.current?.focus();
        });
      }
    } finally {
      setArchiving(false);
    }
  }

  // The card renders even with no Habits: it is the only place to create the
  // first one, so hiding it when empty made the feature unreachable.
  return (
    <section className="rail-card captured-card habits-card" aria-labelledby="habits-heading">
      <p className="eyebrow">Check-ins</p>
      <h2 className="captured-heading" id="habits-heading">
        Habits
      </h2>

      {habits.length === 0 ? (
        <p className="quiet-empty">No habits yet. Add one to start recording.</p>
      ) : (
        <div className="habits-list">
          {habits.map((habit, index) => (
            <HabitRowItem
              key={`${habit.id}:${todayKey}`}
              habit={habit}
              index={index}
              total={habits.length}
              todayKey={todayKey}
              busy={busyHabitIds.has(habit.id)}
              reorderPending={Boolean(reorderPending)}
              onReorder={(id, dir) => void handleReorder(id, dir)}
              moveUpButtonRef={(node) => {
                if (node) {
                  moveUpButtonRefs.current.set(habit.id, node);
                } else {
                  moveUpButtonRefs.current.delete(habit.id);
                }
              }}
              moveDownButtonRef={(node) => {
                if (node) {
                  moveDownButtonRefs.current.set(habit.id, node);
                } else {
                  moveDownButtonRefs.current.delete(habit.id);
                }
              }}
              isEditing={editingHabitId === habit.id}
              renameDraft={renameDraft}
              renameError={renameError}
              renaming={submittingRenameHabitId === habit.id}
              onStartRename={startRename}
              onCancelRename={cancelRename}
              onRenameDraftChange={setRenameDraft}
              onRenameSubmit={(id) => void handleRenameSubmit(id)}
              onArchive={(h) => setArchivingHabit(h)}
              onRecord={onRecord}
              toggleRef={(node) => {
                if (node) {
                  habitToggleRefs.current.set(habit.id, node);
                } else {
                  habitToggleRefs.current.delete(habit.id);
                }
              }}
              renameButtonRef={(node) => {
                if (node) {
                  renameButtonRefs.current.set(habit.id, node);
                } else {
                  renameButtonRefs.current.delete(habit.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <form
        className="habit-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          // The draft survives a failed create, matching every other capture
          // field on this page.
          void onCreate(
            trimmed,
            cadence,
            cadence === "TIMES_PER_WEEK" ? targetPerWeek : 7
          ).then((saved) => {
            if (saved) {
              setDraft("");
              setCadence("DAILY");
              setTargetPerWeek(3);
            }
          });
        }}
      >
        <input
          ref={createInputRef}
          className="habit-create-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a habit"
          aria-label="New habit name"
          disabled={createPending}
        />
        <select
          className="habit-create-select"
          value={cadence}
          onChange={(event) =>
            setCadence(event.target.value as HabitCadenceValue)
          }
          aria-label="Cadence"
          disabled={createPending}
        >
          <option value="DAILY">Daily</option>
          <option value="TIMES_PER_WEEK">Times per week</option>
        </select>
        {cadence === "TIMES_PER_WEEK" && (
          <input
            className="habit-create-target"
            type="number"
            min={1}
            max={7}
            value={targetPerWeek}
            onChange={(event) => {
              const val = parseInt(event.target.value, 10);
              setTargetPerWeek(
                Number.isNaN(val) ? 1 : Math.min(Math.max(val, 1), 7)
              );
            }}
            aria-label="Target days per week"
            disabled={createPending}
          />
        )}
        <button
          type="submit"
          className="secondary-button"
          disabled={createPending || !trimmed}
        >
          Add habit
        </button>
      </form>

      {archivingHabit && (
        <div
          className="project-delete-confirm-overlay"
          role="presentation"
          onMouseDown={() => {
            if (!archiving) setArchivingHabit(null);
          }}
        >
          <section
            ref={archiveDialogRef}
            className="project-delete-confirm"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={`Archive ${archivingHabit.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Archive habit, keep check-ins</span>
            <h2>Archive “{archivingHabit.name}”?</h2>
            <p>
              Archiving keeps every Check-in and hides the Habit from Today.
            </p>
            <div>
              <button
                type="button"
                className="primary-button"
                disabled={archiving}
                onClick={() => void handleArchiveConfirm()}
              >
                {archiving ? "Archiving…" : "Archive habit"}
              </button>
              <button
                ref={keepHabitRef}
                type="button"
                className="secondary-button"
                disabled={archiving}
                onClick={() => setArchivingHabit(null)}
              >
                Keep habit
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function HabitRowItem({
  habit,
  index,
  total,
  busy,
  reorderPending,
  onReorder,
  moveUpButtonRef,
  moveDownButtonRef,
  isEditing,
  renameDraft,
  renameError,
  renaming,
  onStartRename,
  onCancelRename,
  onRenameDraftChange,
  onRenameSubmit,
  onArchive,
  onRecord,
  toggleRef,
  renameButtonRef,
  todayKey
}: {
  habit: HabitSummary;
  index: number;
  total: number;
  busy: boolean;
  reorderPending: boolean;
  onReorder: (habitId: string, direction: "up" | "down") => void;
  moveUpButtonRef: (node: HTMLButtonElement | null) => void;
  moveDownButtonRef: (node: HTMLButtonElement | null) => void;
  isEditing: boolean;
  renameDraft: string;
  renameError: string;
  renaming: boolean;
  todayKey: string;
  onStartRename: (habitId: string, name: string) => void;
  onCancelRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onRenameSubmit: (habitId: string) => void;
  onArchive: (habit: HabitSummary) => void;
  onRecord: (
    habitId: string,
    done: boolean,
    details?: { amount?: number | null; note?: string | null }
  ) => Promise<{ ok: boolean; error?: string; field?: string }>;
  toggleRef: (node: HTMLButtonElement | null) => void;
  renameButtonRef: (node: HTMLButtonElement | null) => void;
}) {
  const recorded = habit.today !== null;
  const done = habit.today?.done === true;

  const [amountDraft, setAmountDraft] = useState(
    () =>
      habit.today?.amount !== null && habit.today?.amount !== undefined
        ? String(habit.today.amount)
        : ""
  );
  const [noteDraft, setNoteDraft] = useState(() => habit.today?.note ?? "");
  const [touchedAmount, setTouchedAmount] = useState(false);
  const [touchedNote, setTouchedNote] = useState(false);
  const [amountError, setAmountError] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    setTouchedAmount(false);
    setTouchedNote(false);
    setAmountDraft(
      habit.today?.amount !== null && habit.today?.amount !== undefined
        ? String(habit.today.amount)
        : ""
    );
    setNoteDraft(habit.today?.note ?? "");
    setAmountError("");
    setNoteError("");
  }, [todayKey]);

  useEffect(() => {
    if (!touchedAmount) {
      setAmountDraft(
        habit.today?.amount !== null && habit.today?.amount !== undefined
          ? String(habit.today.amount)
          : ""
      );
    }
  }, [habit.today?.amount, touchedAmount]);

  useEffect(() => {
    if (!touchedNote) {
      setNoteDraft(habit.today?.note ?? "");
    }
  }, [habit.today?.note, touchedNote]);

  async function handleSaveDetails() {
    if (!habit.today) return;
    setSavingDetails(true);
    setAmountError("");
    setNoteError("");

    const details: { amount?: number | null; note?: string | null } = {};

    if (touchedAmount) {
      const trimmed = amountDraft.trim();
      details.amount = trimmed === "" ? null : Number(trimmed);
    }

    if (touchedNote) {
      details.note = noteDraft === "" ? null : noteDraft;
    }

    try {
      const res = await onRecord(habit.id, habit.today.done, details);
      if (res.ok) {
        setTouchedAmount(false);
        setTouchedNote(false);
        setAmountError("");
        setNoteError("");
      } else {
        if (res.field === "amount") {
          setAmountError(
            res.error ?? "Check-in amount must be a whole number of 0 or more."
          );
        } else if (res.field === "note") {
          setNoteError(
            res.error ?? "Check-in note must be 2,000 characters or fewer."
          );
        } else {
          setAmountError(res.error ?? "Check-in could not be saved.");
        }
      }
    } finally {
      setSavingDetails(false);
    }
  }

  return (
    <div data-habit={habit.id} className="habit-row-item">
      {isEditing ? (
        <form
          className="habit-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            onRenameSubmit(habit.id);
          }}
        >
          <div className="habit-rename-row">
            <input
              className="habit-rename-input"
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              aria-label={`Rename ${habit.name}`}
              disabled={renaming}
              autoFocus
            />
            <button
              type="submit"
              className="secondary-button"
              disabled={renaming}
            >
              {renaming ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={renaming}
              onClick={onCancelRename}
            >
              Cancel
            </button>
          </div>
          {renameError && (
            <span className="form-error" role="alert">
              {renameError}
            </span>
          )}
        </form>
      ) : (
        <>
          <div className="habit-row-header">
            <button
              ref={toggleRef}
              type="button"
              className="secondary-button habit-toggle-btn"
              aria-pressed={done}
              disabled={busy}
              onClick={() => void onRecord(habit.id, !done)}
            >
              {habit.name}
              {": "}
              {/* Never recorded reads differently from recorded as not done. */}
              {recorded ? (done ? "done today" : "not done today") : "not recorded today"}
            </button>
            <div className="habit-row-actions">
              <button
                ref={moveUpButtonRef}
                type="button"
                className="text-button"
                aria-label={`Move ${habit.name} up`}
                disabled={busy || reorderPending || index === 0}
                onClick={() => onReorder(habit.id, "up")}
              >
                Move up
              </button>
              <button
                ref={moveDownButtonRef}
                type="button"
                className="text-button"
                aria-label={`Move ${habit.name} down`}
                disabled={busy || reorderPending || index === total - 1}
                onClick={() => onReorder(habit.id, "down")}
              >
                Move down
              </button>
              {!recorded && (
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Mark not done for ${habit.name}`}
                  disabled={busy}
                  onClick={() => void onRecord(habit.id, false)}
                >
                  Mark not done
                </button>
              )}
              <button
                ref={renameButtonRef}
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => onStartRename(habit.id, habit.name)}
              >
                Rename
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => onArchive(habit)}
              >
                Archive
              </button>
            </div>
          </div>

          <div className="habit-details-section">
            {!recorded && (
              <div className="habit-unrecorded-hint">
                <span className="habit-hint-text">Record today first</span>
              </div>
            )}
            <div className="habit-details-grid">
              <div className="habit-amount-field">
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  value={amountDraft}
                  onChange={(e) => {
                    setAmountDraft(e.target.value);
                    setTouchedAmount(true);
                    setAmountError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSaveDetails();
                    }
                  }}
                  placeholder="Amount"
                  aria-label={`Amount for ${habit.name}`}
                  disabled={!recorded || busy || savingDetails}
                />
                {amountError && (
                  <span className="form-error" role="alert">
                    {amountError}
                  </span>
                )}
              </div>
              <div className="habit-note-field">
                <textarea
                  rows={2}
                  value={noteDraft}
                  onChange={(e) => {
                    setNoteDraft(e.target.value);
                    setTouchedNote(true);
                    setNoteError("");
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleSaveDetails();
                    }
                  }}
                  placeholder="Note"
                  aria-label={`Note for ${habit.name}`}
                  disabled={!recorded || busy || savingDetails}
                />
                {noteError && (
                  <span className="form-error" role="alert">
                    {noteError}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={!recorded || busy || savingDetails}
                onClick={() => void handleSaveDetails()}
              >
                {savingDetails ? "Saving…" : "Save details"}
              </button>
            </div>
          </div>

          <div className="habit-progress-row">
            <span className="habit-count-label">
              {habit.doneCount} of {habit.target} this period
            </span>
            <span className="habit-day-dots" aria-label={`${habit.name} by day`}>
              {habit.days.map((day) => (
                <span key={day.day} title={`${day.day}: ${DAY_LABEL[day.state]}`}>
                  {DAY_MARK[day.state]}
                </span>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
