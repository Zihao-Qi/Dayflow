"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import type { FocusSessionRecord } from "@/lib/focus-domain";
import type { QueuePlacement } from "@/lib/focus-queue";
import type { ProjectSummary } from "@/lib/project-domain";
import type { FocusQueueEntry, FocusTask } from "./focus-model";

export function FocusQueueCard({
  session,
  tasks,
  entries,
  projects,
  onQueueTask,
  onRemoveQueuedTask,
  onReorderQueue,
  onBreakQueuePositionChange,
  onAnnounce
}: {
  session: FocusSessionRecord;
  tasks: FocusTask[];
  entries: FocusQueueEntry[];
  projects: ProjectSummary[];
  onQueueTask?: (taskId: string, placement: QueuePlacement) => Promise<boolean>;
  onRemoveQueuedTask?: (taskId: string) => Promise<boolean>;
  onReorderQueue?: (ids: string[], announcement: string) => Promise<boolean>;
  onBreakQueuePositionChange: (position: number | null) => void;
  onAnnounce?: (message: string) => void;
}) {
  const [reorderMode, setReorderMode] = useState(false);
  const [queueTaskId, setQueueTaskId] = useState("");
  const reorderButtonRef = useRef<HTMLButtonElement | null>(null);
  const totalMinutes = entries.reduce(
    (sum, entry) => sum + entry.durationMinutes,
    0
  );
  const availableTasks = tasks.filter(
    (task) =>
      task.id !== session.taskId &&
      (task.focusQueuePosition === null ||
        task.focusQueuePosition === undefined)
  );

  useEffect(() => {
    if (entries.length >= 2 || !reorderMode) return;
    setReorderMode(false);
  }, [entries.length, reorderMode]);

  useEffect(() => {
    if (!reorderMode) return;
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setReorderMode(false);
      window.setTimeout(() => reorderButtonRef.current?.focus(), 0);
    }
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [reorderMode]);

  function finishReordering() {
    setReorderMode(false);
    window.setTimeout(() => reorderButtonRef.current?.focus(), 0);
  }

  async function saveEntryOrder(
    reordered: FocusQueueEntry[],
    entry: FocusQueueEntry,
    nextIndex: number
  ) {
    if (!onReorderQueue) return false;
    const previousBreakIndex = entries.findIndex(
      (item) => item.kind === "break"
    );
    const nextBreakIndex = reordered.findIndex(
      (item) => item.kind === "break"
    );
    onBreakQueuePositionChange(nextBreakIndex >= 0 ? nextBreakIndex : null);
    const moved = await onReorderQueue(
      reordered
        .filter((item): item is Extract<FocusQueueEntry, { kind: "task" }> =>
          item.kind === "task"
        )
        .map((item) => item.task.id),
      `${entry.title}, now ${nextIndex + 1} of ${entries.length}.`
    );
    if (!moved) {
      onBreakQueuePositionChange(
        previousBreakIndex >= 0 ? previousBreakIndex : null
      );
    }
    return moved;
  }

  async function moveQueueEntry(
    entry: FocusQueueEntry,
    index: number,
    direction: -1 | 1
  ) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= entries.length || !onReorderQueue) return;
    const reordered = [...entries];
    reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, entry);
    const moved = await saveEntryOrder(reordered, entry, nextIndex);
    if (!moved) return;
    window.requestAnimationFrame(() => {
      const preferred =
        nextIndex === 0
          ? "down"
          : nextIndex === entries.length - 1
            ? "up"
            : direction < 0
              ? "up"
              : "down";
      document
        .querySelector<HTMLButtonElement>(
          `[data-queue-entry="${entry.id}"][data-queue-direction="${preferred}"]`
        )
        ?.focus();
    });
  }

  function dropQueueEntry(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId || !onReorderQueue) return;
    const sourceIndex = entries.findIndex((entry) => entry.id === sourceId);
    const targetIndex = entries.findIndex((entry) => entry.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...entries];
    const [entry] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, entry);
    void saveEntryOrder(reordered, entry, targetIndex);
  }

  function removeEntry(entry: FocusQueueEntry) {
    if (entry.kind === "task") {
      void onRemoveQueuedTask?.(entry.task.id);
      return;
    }
    onBreakQueuePositionChange(null);
    onAnnounce?.("Break — stand up, removed from the queue.");
  }

  async function addSelectedTask() {
    if (!queueTaskId || !onQueueTask) return;
    if (await onQueueTask(queueTaskId, "end")) setQueueTaskId("");
  }

  return (
    <section className="rail-card focus-queue-card">
      <header className="focus-queue-heading">
        <span className="eyebrow">Queue after this</span>
        <div>
          <strong>{totalMinutes}m</strong>
          {entries.length >= 2 && onReorderQueue && (
            <button
              ref={reorderButtonRef}
              type="button"
              className="text-button queue-reorder-toggle"
              aria-pressed={reorderMode}
              onClick={() => {
                if (reorderMode) finishReordering();
                else setReorderMode(true);
              }}
            >
              {reorderMode ? "Done" : "Reorder"}
            </button>
          )}
        </div>
      </header>

      {entries.length ? (
        <>
          <p className="focus-queue-intro">
            Finishing this session starts {entries[0].title} unless you change it.
          </p>
          <div className="focus-queue">
            {entries.map((entry, index) => (
              <div
                className={`focus-queue-entry ${reorderMode ? "reordering" : ""}`}
                key={entry.id}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/plain", entry.id)
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  dropQueueEntry(
                    event.dataTransfer.getData("text/plain"),
                    entry.id
                  );
                }}
              >
                <GripVertical
                  className="focus-queue-drag"
                  size={13}
                  aria-hidden="true"
                />
                <time>{entry.durationMinutes}m</time>
                <span>
                  <strong>
                    {entry.kind === "break" ? "Break" : entry.title}
                  </strong>
                  <small>
                    {entry.kind === "break"
                      ? "Stand up"
                      : entry.task.projectId
                        ? projects.find(
                            (project) =>
                              project.id === entry.task.projectId
                          )?.name ?? "Project"
                        : "Standalone"}
                  </small>
                </span>
                {reorderMode ? (
                  <div className="focus-queue-reorder">
                    <span>{index + 1} of {entries.length}</span>
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${entry.title} up`}
                      data-queue-entry={entry.id}
                      data-queue-direction="up"
                      onClick={() => void moveQueueEntry(entry, index, -1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === entries.length - 1}
                      aria-label={`Move ${entry.title} down`}
                      data-queue-entry={entry.id}
                      data-queue-direction="down"
                      onClick={() => void moveQueueEntry(entry, index, 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="focus-queue-remove"
                      aria-label={`Remove ${entry.title} from queue`}
                      onClick={() => removeEntry(entry)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : (
                  (entry.kind === "break" || onRemoveQueuedTask) && (
                    <button
                      type="button"
                      className="focus-queue-remove"
                      aria-label={`Remove ${entry.title} from queue`}
                      onClick={() => removeEntry(entry)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="focus-queue-empty">
          Nothing queued. Finishing this session returns you to Today.
        </p>
      )}

      {onQueueTask && (
        <div className="focus-queue-add">
          <label htmlFor={`focus-queue-add-${session.id}`}>Add to queue</label>
          <div>
            <select
              id={`focus-queue-add-${session.id}`}
              value={queueTaskId}
              onChange={(event) => setQueueTaskId(event.target.value)}
            >
              <option value="">Choose a task</option>
              {availableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-button"
              disabled={!queueTaskId}
              onClick={() => void addSelectedTask()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
