"use client";

import { useMemo, useState } from "react";
import {
  useJournalEvidenceHistory,
  type JournalHistoryResult,
  type NoteHistoryCriteria,
  type ReferenceHistoryCriteria
} from "@/components/use-journal-evidence-history";
import type { ProjectSummary } from "@/lib/project-domain";
import {
  mergeJournalRecords,
  type Diary,
  type JournalTaskOption,
  type JournalView,
  type Material,
  type Note
} from "@/modules/journal/ui/journal-model";

/**
 * The slice of the bootstrap payload the Journal reads. It is null until
 * bootstrap lands, which is why the page data below is null with it.
 */
export type JournalBootstrapSlice = {
  today: string;
  diary: Diary;
  notes: Note[];
  materials: Material[];
  tasks: JournalTaskOption[];
  paletteTasks: JournalTaskOption[];
  projects: Map<string, ProjectSummary>;
};

export type JournalPageData = {
  today: string;
  view: JournalView;
  onViewChange: (view: JournalView) => void;
  diary: Diary;
  notes: Note[];
  materials: Material[];
  noteHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  materialHistory: JournalHistoryResult<Material, ReferenceHistoryCriteria>;
  noteOptionHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  tasks: JournalTaskOption[];
  noteOptions: Note[];
  projects: Map<string, ProjectSummary>;
};

export type JournalPageState = {
  view: JournalView;
  setView: (view: JournalView) => void;
  tasks: JournalTaskOption[];
  noteHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  materialHistory: JournalHistoryResult<Material, ReferenceHistoryCriteria>;
  noteOptionHistory: JournalHistoryResult<Note, NoteHistoryCriteria>;
  page: JournalPageData | null;
};

/**
 * Called by the shell, not by the page, so the paginated histories keep their
 * loaded pages, search and tag filters while another destination is on screen.
 */
export function useJournalPage(
  active: boolean,
  bootstrap: JournalBootstrapSlice | null
): JournalPageState {
  const [view, setView] = useState<JournalView>("daily");
  const noteHistory = useJournalEvidenceHistory(
    "note",
    active && view === "notes"
  );
  const materialHistory = useJournalEvidenceHistory(
    "material",
    active && view === "references"
  );
  const noteOptionHistory = useJournalEvidenceHistory(
    "note",
    active && view === "references"
  );
  const paletteTasks = bootstrap?.paletteTasks;
  const bootstrapTasks = bootstrap?.tasks;
  const bootstrapNotes = bootstrap?.notes;
  const tasks = useMemo(() => {
    const byId = new Map<string, JournalTaskOption>();
    for (const task of [...(paletteTasks ?? []), ...(bootstrapTasks ?? [])]) {
      byId.set(task.id, {
        id: task.id,
        title: task.title,
        projectId: task.projectId
      });
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.title.localeCompare(right.title, undefined, {
          sensitivity: "base"
        }) || left.id.localeCompare(right.id)
    );
  }, [paletteTasks, bootstrapTasks]);
  const noteOptions = useMemo(
    () => mergeJournalRecords(noteOptionHistory.items, bootstrapNotes ?? []),
    [bootstrapNotes, noteOptionHistory.items]
  );

  return {
    view,
    setView,
    tasks,
    noteHistory,
    materialHistory,
    noteOptionHistory,
    page: bootstrap
      ? {
          today: bootstrap.today,
          view,
          onViewChange: setView,
          diary: bootstrap.diary,
          notes: view === "notes" ? noteHistory.items : bootstrap.notes,
          materials:
            view === "references"
              ? materialHistory.items
              : bootstrap.materials,
          noteHistory,
          materialHistory,
          noteOptionHistory,
          tasks,
          noteOptions,
          projects: bootstrap.projects
        }
      : null
  };
}
