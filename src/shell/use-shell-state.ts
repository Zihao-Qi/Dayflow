"use client";

import {
  type TimeBlockEditorDraft,
  type TimeBlockErrorField
} from "@/components/time-block-dialog";
import { type JournalMaterialRecord, type JournalNoteRecord } from "@/lib/journal-records";
import { type TimeBlockRecord, type TimeBlockTaskSummary } from "@/lib/time-blocks";
import { FocusDraft } from "@/modules/focus/ui/focus-rail";
import {
  useJournalPage,
  type MaterialCaptureDraft,
  type NoteCaptureDraft
} from "@/modules/journal/ui";
import type { Bootstrap } from "@/shared/client/decoders";
import { type PendingMutation } from "@/shared/client/mutation-ids";
import { useMemo, useRef, useState } from "react";

export type Screen =
  | "today"
  | "day-stream"
  | "day-timeline"
  | "projects"
  | "backlog"
  | "journal"
  | "review";
export type DayView = "stream" | "timeline";
export type TimeBlockEditor = {
  id: string | null;
  date: string;
  originalTask: TimeBlockTaskSummary | null;
  linkedTask: TimeBlockTaskSummary | null;
  draft: TimeBlockEditorDraft;
};

export type Note = JournalNoteRecord;

export type Material = JournalMaterialRecord;

export type TimeBlock = TimeBlockRecord;

export type BootstrapFailure = {
  code: string;
  message: string;
};

export const emptyNoteCaptureDraft: NoteCaptureDraft = {
  content: "",
  tags: "",
  taskId: "",
  projectId: ""
};
export const emptyMaterialCaptureDraft: MaterialCaptureDraft = {
  title: "",
  url: "",
  notes: "",
  taskId: "",
  noteId: "",
  projectId: ""
};

/** Keep these hooks in dashboard order; all drafts outlive destination mounts. */
export function useShellState() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [bootstrapFailure, setBootstrapFailure] =
    useState<BootstrapFailure | null>(null);
  const [screen, setScreen] = useState<Screen>("today");
  const [railExpanded, setRailExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const projectById = useMemo(
    () => new Map((data?.projects ?? []).map((project) => [project.id, project])),
    [data]
  );
  const journal = useJournalPage(
    screen === "journal",
    data && {
      today: data.today,
      diary: data.diary,
      notes: data.notes,
      materials: data.materials,
      tasks: data.tasks,
      paletteTasks: data.paletteTasks,
      projects: projectById
    }
  );
  const [newTask, setNewTask] = useState("");
  const [taskCreatePending, setTaskCreatePending] = useState(false);
  const [noteDraft, setNoteDraft] = useState<NoteCaptureDraft>(
    emptyNoteCaptureDraft
  );
  const [noteSaving, setNoteSaving] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<MaterialCaptureDraft>(
    emptyMaterialCaptureDraft
  );
  const [materialSaving, setMaterialSaving] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [focusDraft, setFocusDraft] = useState<FocusDraft | null>(null);
  const [timeBlockEditor, setTimeBlockEditor] =
    useState<TimeBlockEditor | null>(null);
  const [timeBlockError, setTimeBlockError] = useState("");
  const [timeBlockErrorField, setTimeBlockErrorField] =
    useState<TimeBlockErrorField | null>(null);
  const [timeBlockSaving, setTimeBlockSaving] = useState(false);
  const [dismissedUnfinished, setDismissedUnfinished] = useState<string[]>([]);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [firstRunSeen, setFirstRunSeen] = useState<boolean | null>(null);
  const [appAnnouncement, setAppAnnouncement] = useState("");
  const [appError, setAppError] = useState("");
  const taskSaveWasInError = useRef(false);
  const diarySaveWasInError = useRef(false);
  const reviewSaveWasInError = useRef(false);
  const taskCreateWasInError = useRef(false);
  const noteCreateWasInError = useRef(false);
  const materialCreateWasInError = useRef(false);
  const taskCreateMutation = useRef<PendingMutation | null>(null);
  const noteCreateMutation = useRef<PendingMutation | null>(null);
  const materialCreateMutation = useRef<PendingMutation | null>(null);
  const timeBlockCreateMutation = useRef<PendingMutation | null>(null);
  const paletteOpener = useRef<HTMLElement | null>(null);

  return {
    data,
    setData,
    bootstrapFailure,
    setBootstrapFailure,
    screen,
    setScreen,
    railExpanded,
    setRailExpanded,
    paletteOpen,
    setPaletteOpen,
    paletteQuery,
    setPaletteQuery,
    projectById,
    journal,
    newTask,
    setNewTask,
    taskCreatePending,
    setTaskCreatePending,
    noteDraft,
    setNoteDraft,
    noteSaving,
    setNoteSaving,
    materialDraft,
    setMaterialDraft,
    materialSaving,
    setMaterialSaving,
    selectedProjectId,
    setSelectedProjectId,
    projectCreateOpen,
    setProjectCreateOpen,
    focusDraft,
    setFocusDraft,
    timeBlockEditor,
    setTimeBlockEditor,
    timeBlockError,
    setTimeBlockError,
    timeBlockErrorField,
    setTimeBlockErrorField,
    timeBlockSaving,
    setTimeBlockSaving,
    dismissedUnfinished,
    setDismissedUnfinished,
    mobileMoreOpen,
    setMobileMoreOpen,
    dataManagementOpen,
    setDataManagementOpen,
    firstRunSeen,
    setFirstRunSeen,
    appAnnouncement,
    setAppAnnouncement,
    appError,
    setAppError,
    taskSaveWasInError,
    diarySaveWasInError,
    reviewSaveWasInError,
    taskCreateWasInError,
    noteCreateWasInError,
    materialCreateWasInError,
    taskCreateMutation,
    noteCreateMutation,
    materialCreateMutation,
    timeBlockCreateMutation,
    paletteOpener
  };
}

export type ShellState = ReturnType<typeof useShellState>;
