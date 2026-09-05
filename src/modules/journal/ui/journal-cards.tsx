"use client";

import { ExternalLink } from "lucide-react";
import type { ProjectSummary } from "@/lib/project-domain";
import type {
  JournalTaskOption,
  Material,
  Note
} from "@/modules/journal/ui/journal-model";

export function NoteCards({
  notes,
  projects,
  tasks,
  onTagSelect,
  emptyCopy = "No notes captured today."
}: {
  notes: Note[];
  projects: Map<string, ProjectSummary>;
  tasks: JournalTaskOption[];
  onTagSelect?: (tag: string) => void;
  emptyCopy?: string;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return (
    <div className="note-list">
      {notes.map((note) => {
        const task = note.taskId ? taskById.get(note.taskId) : null;
        const projectId = task?.projectId ?? note.projectId;
        const details = [
          note.taskId ? `Task: ${task?.title ?? "Linked task"}` : "",
          projectId && projects.get(projectId)
            ? projects.get(projectId)?.name ?? ""
            : ""
        ].filter(Boolean);
        return (
          <article className="note-card" key={note.id}>
            <p>{note.content}</p>
            {note.tags.length > 0 && (
              <div className="note-tag-list" aria-label="Note tags">
                {note.tags.map((tag) =>
                  onTagSelect ? (
                    <button
                      className="note-tag"
                      type="button"
                      key={tag}
                      onClick={() => onTagSelect(tag)}
                    >
                      #{tag}
                    </button>
                  ) : (
                    <span className="note-tag" key={tag}>
                      #{tag}
                    </span>
                  )
                )}
              </div>
            )}
            {details.length > 0 && <small>{details.join(" · ")}</small>}
          </article>
        );
      })}
      {!notes.length && emptyCopy && <p className="empty-copy">{emptyCopy}</p>}
    </div>
  );
}

export function ReferenceCards({
  materials,
  projects,
  tasks,
  notes,
  emptyCopy = "No references saved yet."
}: {
  materials: Material[];
  projects: Map<string, ProjectSummary>;
  tasks: JournalTaskOption[];
  notes: Note[];
  emptyCopy?: string;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const noteById = new Map(notes.map((note) => [note.id, note]));
  return (
    <div className="material-list">
      {materials.map((material) => {
        const task = material.taskId
          ? taskById.get(material.taskId)
          : null;
        const note = material.noteId
          ? noteById.get(material.noteId)
          : null;
        const projectId = task?.projectId ?? material.projectId;
        const details = [
          material.notes,
          material.taskId ? `Task: ${task?.title ?? "Linked task"}` : "",
          material.noteId
            ? `Note: ${note ? noteOptionLabel(note) : "Linked note"}`
            : "",
          projectId && projects.get(projectId)
            ? projects.get(projectId)?.name ?? ""
            : ""
        ].filter(Boolean);
        return (
          <a
            className="material-item"
            href={material.url}
            target="_blank"
            rel="noreferrer"
            key={material.id}
          >
            <span>{material.type}</span>
            <strong>{material.title}</strong>
            {details.length > 0 && <small>{details.join(" · ")}</small>}
            <ExternalLink size={13} />
          </a>
        );
      })}
      {!materials.length && emptyCopy && <p className="empty-copy">{emptyCopy}</p>}
    </div>
  );
}

export function noteOptionLabel(note: Note) {
  const summary = note.content.replace(/\s+/g, " ").trim();
  return summary.length > 72 ? `${summary.slice(0, 71).trimEnd()}…` : summary;
}
