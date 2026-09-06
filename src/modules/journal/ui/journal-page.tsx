"use client";

import { LinkIcon, Plus, Save } from "lucide-react";
import { formatLongDate } from "@/components/dashboard-formatters";
import { SaveStateChip, useSaveState } from "@/components/save-state";
import { PageHeader, SegmentedControl } from "@/components/workspace-ui";
import {
  NoteCards,
  ReferenceCards,
  noteOptionLabel
} from "@/modules/journal/ui/journal-cards";
import { HistoryFooter } from "@/modules/journal/ui/journal-history-footer";
import {
  diariesEqual,
  taskProjectIdFor,
  type Diary,
  type MaterialCaptureDraft,
  type NoteCaptureDraft
} from "@/modules/journal/ui/journal-model";
import { JournalSearchControls } from "@/modules/journal/ui/journal-search-controls";
import type { JournalPageData } from "@/modules/journal/ui/use-journal-page";

export type JournalPageProps = JournalPageData & {
  onDiaryChange: <K extends keyof Diary>(key: K, value: Diary[K]) => void;
  onSaveDiary: (diary: Diary) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  noteDraft: NoteCaptureDraft;
  noteSaving: boolean;
  onNoteDraftChange: (
    field: Exclude<keyof NoteCaptureDraft, "taskId">,
    value: string
  ) => void;
  onNoteTaskChange: (value: string) => void;
  onAddNote: () => Promise<void>;
  materialDraft: MaterialCaptureDraft;
  materialSaving: boolean;
  onMaterialDraftChange: (
    field: Exclude<keyof MaterialCaptureDraft, "taskId">,
    value: string
  ) => void;
  onMaterialTaskChange: (value: string) => void;
  onAddMaterial: () => Promise<void>;
};

export function JournalPage({
  today,
  view,
  onViewChange,
  diary,
  notes,
  materials,
  noteHistory,
  materialHistory,
  noteOptionHistory,
  tasks,
  noteOptions,
  projects,
  onDiaryChange,
  onSaveDiary,
  onSaveError,
  onSaveRecovered,
  noteDraft,
  noteSaving,
  onNoteDraftChange,
  onNoteTaskChange,
  onAddNote,
  materialDraft,
  materialSaving,
  onMaterialDraftChange,
  onMaterialTaskChange,
  onAddMaterial
}: JournalPageProps) {
  const diarySave = useSaveState<Diary>({
    value: diary,
    save: onSaveDiary,
    isEqual: diariesEqual,
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  });

  function updateDiary<K extends keyof Diary>(key: K, value: Diary[K]) {
    diarySave.setDraft({ ...diarySave.draft, [key]: value });
    onDiaryChange(key, value);
  }

  const noteTaskProjectId = taskProjectIdFor(noteDraft.taskId, tasks);
  const materialTaskProjectId = taskProjectIdFor(materialDraft.taskId, tasks);
  const noteFiltersActive = Boolean(
    noteHistory.criteria.q.trim() || noteHistory.criteria.tag.trim()
  );
  const referenceSearchActive = Boolean(
    materialHistory.criteria.q.trim()
  );

  return (
    <div className="journal-page page-stack">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title="Journal"
        actions={
          <SegmentedControl
            ariaLabel="Journal view"
            value={view}
            options={[
              ["daily", "Daily page"],
              [
                "notes",
                countedLabel(
                  "Notes",
                  noteHistory.totalCount ??
                    (view === "notes" ? notes.length : null)
                )
              ],
              [
                "references",
                countedLabel(
                  "References",
                  materialHistory.totalCount ??
                    (view === "references" ? materials.length : null)
                )
              ]
            ]}
            onChange={onViewChange}
          />
        }
      />
      {view === "daily" && (
        <div className="journal-grid">
          <section className="panel daily-page-card">
            <div className="journal-card-heading">
              <h2>Daily page</h2>
              <SaveStateChip
                state={diarySave.state}
                onRetry={() => void diarySave.flush(true)}
              />
            </div>
            <textarea
              value={diarySave.draft.content}
              onChange={(event) => updateDiary("content", event.target.value)}
              placeholder="Write a few lines about the day."
              {...diarySave.inputProps}
            />
            <div className="journal-footer">
              <label>
                Mood · {diarySave.draft.mood}/5
                <input
                  type="range"
                  aria-label="Mood"
                  min="1"
                  max="5"
                  value={diarySave.draft.mood}
                  onChange={(event) => updateDiary("mood", Number(event.target.value))}
                  {...diarySave.inputProps}
                />
              </label>
              <label>
                Energy · {diarySave.draft.energy}/5
                <input
                  type="range"
                  aria-label="Energy"
                  min="1"
                  max="5"
                  value={diarySave.draft.energy}
                  onChange={(event) => updateDiary("energy", Number(event.target.value))}
                  {...diarySave.inputProps}
                />
              </label>
              <button
                className="primary-button"
                onClick={() => void diarySave.flush(true)}
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </section>
          <aside className="journal-captured">
            <span className="eyebrow">Captured today</span>
            <NoteCards
              notes={notes.slice(0, 2)}
              projects={projects}
              tasks={tasks}
            />
            <button className="rail-link" onClick={() => onViewChange("notes")}>
              New note<span className="desktop-shortcut"> · ⌘K</span>
            </button>
            <span className="eyebrow references-label">References</span>
            <ReferenceCards
              materials={materials.slice(0, 3)}
              projects={projects}
              tasks={tasks}
              notes={noteOptions}
            />
          </aside>
        </div>
      )}
      {view === "notes" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>New note</h2>
            <textarea
              id="new-note"
              value={noteDraft.content}
              disabled={noteSaving}
              onChange={(event) =>
                onNoteDraftChange("content", event.target.value)
              }
              placeholder="Capture a thought, decision, or reminder."
            />
            <input
              value={noteDraft.tags}
              disabled={noteSaving}
              onChange={(event) =>
                onNoteDraftChange("tags", event.target.value)
              }
              placeholder="Tags, comma separated"
            />
            <label>
              Linked task
              <select
                aria-label="Note linked task"
                value={noteDraft.taskId}
                disabled={noteSaving}
                onChange={(event) => onNoteTaskChange(event.target.value)}
              >
                <option value="">No linked task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                aria-label="Project"
                value={noteTaskProjectId ?? noteDraft.projectId}
                disabled={noteSaving || Boolean(noteTaskProjectId)}
                onChange={(event) =>
                  onNoteDraftChange("projectId", event.target.value)
                }
              >
                <option value="">No Project</option>
                {[...projects.values()].map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {noteTaskProjectId && <small>Inherited from linked task</small>}
            </label>
            <button
              className="primary-button"
              disabled={noteSaving || !noteDraft.content.trim()}
              onClick={() => void onAddNote()}
            >
              <Plus size={14} />
              {noteSaving ? "Saving…" : "Save note"}
            </button>
          </section>
          <section className="journal-history-results">
            <JournalSearchControls
              kind="note"
              text={noteHistory.criteria.q}
              tag={noteHistory.criteria.tag}
              loading={noteHistory.loading}
              onTextChange={(q) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  q
                })
              }
              onTagChange={(tag) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  tag
                })
              }
              onClear={() =>
                noteHistory.setCriteria({ q: "", tag: "" })
              }
            />
            <NoteCards
              notes={notes}
              projects={projects}
              tasks={tasks}
              onTagSelect={(tag) =>
                noteHistory.setCriteria({
                  ...noteHistory.criteria,
                  tag
                })
              }
              emptyCopy={
                noteHistory.loading || noteHistory.error
                  ? ""
                  : noteFiltersActive
                    ? "No notes match these filters."
                    : "No notes saved yet."
              }
            />
            <HistoryFooter
              noun="notes"
              state={noteHistory}
              onLoadMore={noteHistory.loadNext}
              onRetry={noteHistory.retry}
            />
          </section>
        </div>
      )}
      {view === "references" && (
        <div className="capture-workspace">
          <section className="panel capture-form">
            <h2>Save reference</h2>
            <input
              value={materialDraft.title}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("title", event.target.value)
              }
              placeholder="Title"
            />
            <input
              id="material-url"
              value={materialDraft.url}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("url", event.target.value)
              }
              placeholder="URL"
            />
            <textarea
              value={materialDraft.notes}
              disabled={materialSaving}
              onChange={(event) =>
                onMaterialDraftChange("notes", event.target.value)
              }
              placeholder="Why this matters"
            />
            <label>
              Linked task
              <select
                aria-label="Reference linked task"
                value={materialDraft.taskId}
                disabled={materialSaving}
                onChange={(event) => onMaterialTaskChange(event.target.value)}
              >
                <option value="">No linked task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Linked note
              <select
                aria-label="Reference linked note"
                value={materialDraft.noteId}
                disabled={materialSaving || noteOptionHistory.loading}
                onChange={(event) =>
                  onMaterialDraftChange("noteId", event.target.value)
                }
              >
                <option value="">No linked note</option>
                {noteOptions.map((note) => (
                  <option key={note.id} value={note.id}>
                    {noteOptionLabel(note)}
                  </option>
                ))}
              </select>
            </label>
            {noteOptionHistory.nextCursor && (
              <button
                className="text-button journal-note-options-more"
                type="button"
                disabled={noteOptionHistory.loading || materialSaving}
                onClick={noteOptionHistory.loadNext}
              >
                {noteOptionHistory.loading ? "Loading…" : "Load older notes"}
              </button>
            )}
            {noteOptionHistory.error && (
              <div className="journal-note-options-error" role="alert">
                <span>{noteOptionHistory.error}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={noteOptionHistory.retry}
                >
                  Retry notes
                </button>
              </div>
            )}
            <label>
              Project
              <select
                aria-label="Project"
                value={materialTaskProjectId ?? materialDraft.projectId}
                disabled={materialSaving || Boolean(materialTaskProjectId)}
                onChange={(event) =>
                  onMaterialDraftChange("projectId", event.target.value)
                }
              >
                <option value="">No Project</option>
                {[...projects.values()].map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {materialTaskProjectId && (
                <small>Inherited from linked task</small>
              )}
            </label>
            <button
              className="primary-button"
              disabled={materialSaving || !materialDraft.url.trim()}
              onClick={() => void onAddMaterial()}
            >
              <LinkIcon size={14} />
              {materialSaving ? "Saving…" : "Save reference"}
            </button>
          </section>
          <section className="journal-history-results">
            <JournalSearchControls
              kind="material"
              text={materialHistory.criteria.q}
              loading={materialHistory.loading}
              onTextChange={(q) =>
                materialHistory.setCriteria({ q })
              }
              onClear={() =>
                materialHistory.setCriteria({ q: "" })
              }
            />
            <ReferenceCards
              materials={materials}
              projects={projects}
              tasks={tasks}
              notes={noteOptions}
              emptyCopy={
                materialHistory.loading || materialHistory.error
                  ? ""
                  : referenceSearchActive
                    ? "No references match this search."
                    : "No references saved yet."
              }
            />
            <HistoryFooter
              noun="references"
              state={materialHistory}
              onLoadMore={materialHistory.loadNext}
              onRetry={materialHistory.retry}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * A tab count is only shown once it is actually known. These histories load on
 * demand, so promising a number and rendering an ellipsis forever is worse
 * than the plain name.
 */
function countedLabel(name: string, count: number | null) {
  return count === null ? name : `${name} · ${count}`;
}
