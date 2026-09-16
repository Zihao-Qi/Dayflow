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
  onRecord,
  onCreate,
  onRename,
  onArchive,
  busyHabitIds,
  createPending
}: {
  habits: HabitSummary[];
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
  busyHabitIds: ReadonlySet<string>;
  createPending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [cadence, setCadence] = useState<HabitCadenceValue>("DAILY");
  const [targetPerWeek, setTargetPerWeek] = useState(3);
  const trimmed = draft.trim();

  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [archivingHabit, setArchivingHabit] = useState<HabitSummary | null>(null);
  const [archiving, setArchiving] = useState(false);
  const archiveDialogRef = useRef<HTMLElement | null>(null);
  const keepHabitRef = useRef<HTMLButtonElement | null>(null);

  const returnFocusHabitIdRef = useRef<string | null>(null);
  const renameButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const habitToggleRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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

  useModalFocusTrap(
    archiveDialogRef,
    archiving ? null : () => setArchivingHabit(null),
    {
      active: Boolean(archivingHabit),
      initialFocus: keepHabitRef
    }
  );

  function startRename(habitId: string, currentName: string) {
    returnFocusHabitIdRef.current = habitId;
    setEditingHabitId(habitId);
    setRenameDraft(currentName);
    setRenameError("");
  }

  function cancelRename() {
    setEditingHabitId(null);
    setRenameDraft("");
    setRenameError("");
  }

  async function handleRenameSubmit(habitId: string) {
    setRenaming(true);
    try {
      const res = await onRename(habitId, renameDraft);
      if (res.ok) {
        cancelRename();
      } else {
        setRenameError(res.error ?? "Habit could not be renamed.");
      }
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : "Habit could not be renamed."
      );
    } finally {
      setRenaming(false);
    }
  }

  async function handleArchiveConfirm() {
    if (!archivingHabit) return;
    setArchiving(true);
    try {
      const ok = await onArchive(archivingHabit.id);
      if (ok) {
        setArchivingHabit(null);
      }
    } finally {
      setArchiving(false);
    }
  }

  // The card renders even with no Habits: it is the only place to create the
  // first one, so hiding it when empty made the feature unreachable.
  return (
    <section className="rail-card captured-card" aria-labelledby="habits-heading">
      <p className="eyebrow">Check-ins</p>
      <h2 className="captured-heading" id="habits-heading">
        Habits
      </h2>

      {habits.length === 0 ? (
        <p className="quiet-empty">No habits yet. Add one to start recording.</p>
      ) : (
        <div className="captured-list">
          {habits.map((habit) => (
            <HabitRowItem
              key={habit.id}
              habit={habit}
              busy={busyHabitIds.has(habit.id)}
              isEditing={editingHabitId === habit.id}
              renameDraft={renameDraft}
              renameError={renameError}
              renaming={renaming}
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a habit"
          aria-label="New habit name"
          disabled={createPending}
        />
        <select
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
  busy,
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
  renameButtonRef
}: {
  habit: HabitSummary;
  busy: boolean;
  isEditing: boolean;
  renameDraft: string;
  renameError: string;
  renaming: boolean;
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
    <div data-habit={habit.id}>
      {isEditing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onRenameSubmit(habit.id);
          }}
        >
          <input
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
          {renameError && (
            <span className="form-error" role="alert">
              {renameError}
            </span>
          )}
          <div>
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
        </form>
      ) : (
        <>
          <button
            ref={toggleRef}
            type="button"
            className="secondary-button"
            aria-pressed={done}
            disabled={busy}
            onClick={() => void onRecord(habit.id, !done)}
          >
            {habit.name}
            {": "}
            {/* Never recorded reads differently from recorded as not done. */}
            {recorded ? (done ? "done today" : "not done today") : "not recorded today"}
          </button>
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

          <div>
            {!recorded && (
              <span className="quiet-empty">Record today first</span>
            )}
            <div>
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

          <p className="quiet-empty">
            {habit.doneCount} of {habit.target} this period
          </p>
          <p aria-label={`${habit.name} by day`}>
            {habit.days.map((day) => (
              <span key={day.day} title={`${day.day}: ${DAY_LABEL[day.state]}`}>
                {DAY_MARK[day.state]}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
