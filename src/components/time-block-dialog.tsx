"use client";

import { Clock3, Trash2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent
} from "react";
import {
  TIME_BLOCK_TITLE_MAX_LENGTH,
  type TimeBlockTaskSummary
} from "@/lib/time-blocks";

export type TimeBlockEditorDraft = {
  title: string;
  startTime: string;
  endTime: string;
  taskId: string;
};

export type TimeBlockErrorField =
  | "title"
  | "startTime"
  | "endTime"
  | "taskId";

export type TimeBlockDialogProps = {
  mode: "create" | "edit";
  dateLabel: string;
  draft: TimeBlockEditorDraft;
  tasks: TimeBlockTaskSummary[];
  saving: boolean;
  error: string;
  errorField?: TimeBlockErrorField | null;
  onDraftChange: (draft: TimeBlockEditorDraft) => void;
  onTaskChange: (taskId: string) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
};

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element.getClientRects().length > 0);
}

export function TimeBlockDialog({
  mode,
  dateLabel,
  draft,
  tasks,
  saving,
  error,
  errorField,
  onDraftChange,
  onTaskChange,
  onClose,
  onSave,
  onDelete
}: TimeBlockDialogProps) {
  const generatedId = useId();
  const errorId = `${generatedId}-time-block-error`;
  const dialogLabel = mode === "create" ? "Add time block" : "Edit time block";
  const submitLabel = mode === "create" ? "Add block" : "Save changes";
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(saving);
  const confirmationRef = useRef(deleteConfirmationOpen);
  const closeRef = useRef(onClose);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    confirmationRef.current = deleteConfirmationOpen;
  }, [deleteConfirmationOpen]);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (!savingRef.current) titleRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (savingRef.current) return;
        event.preventDefault();
        if (confirmationRef.current) {
          setDeleteConfirmationOpen(false);
          window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
        } else {
          closeRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(focusableSelector)
      ].filter((element) => element.getClientRects().length > 0);

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => {
        if (canReceiveFocus(opener)) opener.focus();
      });
    };
  }, [opener]);

  useEffect(() => {
    if (mode !== "edit") {
      setDeleteConfirmationOpen(false);
    }
  }, [mode]);

  useEffect(() => {
    if (deleteConfirmationOpen) {
      window.requestAnimationFrame(() => keepButtonRef.current?.focus());
    }
  }, [deleteConfirmationOpen]);

  function changeDraft(patch: Partial<TimeBlockEditorDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function dismiss() {
    if (!saving) onClose();
  }

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) dismiss();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saving) void onSave();
  }

  function keepBlock() {
    if (saving) return;
    setDeleteConfirmationOpen(false);
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }

  return (
    <div
      className="time-block-dialog-overlay"
      onClick={handleOverlayClick}
      role="presentation"
    >
      <section
        aria-busy={saving}
        aria-describedby={error ? errorId : undefined}
        aria-label={dialogLabel}
        aria-modal="true"
        className="time-block-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="time-block-dialog-heading">
          <div>
            <span className="time-block-dialog-date">{dateLabel}</span>
            <h2>{dialogLabel}</h2>
          </div>
          <button
            aria-label={`Close ${dialogLabel.toLowerCase()}`}
            className="time-block-dialog-close"
            disabled={saving}
            onClick={dismiss}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>

        <form className="time-block-editor" onSubmit={handleSubmit}>
          <label className="time-block-editor-field">
            <span>Title</span>
            <input
              aria-describedby={errorField === "title" ? errorId : undefined}
              aria-invalid={errorField === "title" || undefined}
              autoFocus
              disabled={saving}
              maxLength={TIME_BLOCK_TITLE_MAX_LENGTH}
              onChange={(event) =>
                changeDraft({ title: event.currentTarget.value })
              }
              ref={titleRef}
              required
              type="text"
              value={draft.title}
            />
          </label>

          <div className="time-block-editor-times">
            <label className="time-block-editor-field">
              <span>Start</span>
              <input
                aria-describedby={
                  errorField === "startTime" ? errorId : undefined
                }
                aria-invalid={errorField === "startTime" || undefined}
                disabled={saving}
                onChange={(event) =>
                  changeDraft({ startTime: event.currentTarget.value })
                }
                required
                type="time"
                value={draft.startTime}
              />
            </label>
            <label className="time-block-editor-field">
              <span>End</span>
              <input
                aria-describedby={
                  errorField === "endTime" ? errorId : undefined
                }
                aria-invalid={errorField === "endTime" || undefined}
                disabled={saving}
                onChange={(event) =>
                  changeDraft({ endTime: event.currentTarget.value })
                }
                required
                type="time"
                value={draft.endTime}
              />
            </label>
          </div>

          <label className="time-block-editor-field">
            <span>Linked task</span>
            <select
              aria-label="Linked task"
              aria-describedby={errorField === "taskId" ? errorId : undefined}
              aria-invalid={errorField === "taskId" || undefined}
              disabled={saving}
              onChange={(event) => onTaskChange(event.currentTarget.value)}
              value={draft.taskId}
            >
              <option value="">No linked task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} · {task.estimateMinutes}m
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="time-block-editor-error" id={errorId} role="alert">
              {error}
            </p>
          )}

          {mode === "edit" && onDelete && (
            <div className="time-block-editor-delete">
              {deleteConfirmationOpen ? (
                <div
                  className="time-block-editor-delete-confirmation"
                  role="group"
                  aria-label="Confirm time block deletion"
                >
                  <p>Delete this time block? This cannot be undone.</p>
                  <div className="time-block-editor-delete-actions">
                    <button
                      disabled={saving}
                      onClick={keepBlock}
                      ref={keepButtonRef}
                      type="button"
                    >
                      Keep block
                    </button>
                    <button
                      className="time-block-editor-delete-button"
                      disabled={saving}
                      onClick={() => void onDelete()}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      Delete block
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="time-block-editor-delete-trigger"
                  disabled={saving}
                  onClick={() => setDeleteConfirmationOpen(true)}
                  ref={deleteTriggerRef}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  Delete block
                </button>
              )}
            </div>
          )}

          <footer className="time-block-editor-actions">
            <button disabled={saving} onClick={dismiss} type="button">
              Cancel
            </button>
            <button
              className="time-block-editor-submit"
              disabled={saving}
              type="submit"
            >
              <Clock3 aria-hidden="true" size={14} />
              {submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
