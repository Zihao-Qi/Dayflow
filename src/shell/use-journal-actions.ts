"use client";

import { normalizeNoteTags } from "@/lib/journal-domain";
import { taskProjectIdFor, type Diary } from "@/modules/journal/ui";
import {
  createMaterial as createMaterialRequest,
  createNote as createNoteRequest,
  saveDiary as saveDiaryRequest
} from "@/modules/journal/ui/api";
import { ApiError } from "@/shared/client/api-client";
import { mutationIdFor } from "@/shared/client/mutation-ids";

import {
  emptyMaterialCaptureDraft,
  emptyNoteCaptureDraft,
  type ShellState
} from "./use-shell-state";

export function useJournalActions({
  data,
  setData,
  journal,
  noteDraft,
  setNoteDraft,
  noteSaving,
  setNoteSaving,
  materialDraft,
  setMaterialDraft,
  materialSaving,
  setMaterialSaving,
  setAppAnnouncement,
  setAppError,
  diarySaveWasInError,
  noteCreateWasInError,
  materialCreateWasInError,
  noteCreateMutation,
  materialCreateMutation,
  refreshAfterConfirmedMutation
}: Pick<
  ShellState,
  | "data"
  | "setData"
  | "journal"
  | "noteDraft"
  | "setNoteDraft"
  | "noteSaving"
  | "setNoteSaving"
  | "materialDraft"
  | "setMaterialDraft"
  | "materialSaving"
  | "setMaterialSaving"
  | "setAppAnnouncement"
  | "setAppError"
  | "diarySaveWasInError"
  | "noteCreateWasInError"
  | "materialCreateWasInError"
  | "noteCreateMutation"
  | "materialCreateMutation"
> & {
  refreshAfterConfirmedMutation: () => Promise<boolean>;
}) {
  function selectNoteTask(taskId: string) {
    setNoteDraft((current) => ({
      ...current,
      taskId,
      projectId: taskProjectIdFor(taskId, journal.tasks)
        ? ""
        : current.projectId
    }));
  }

  function selectMaterialTask(taskId: string) {
    setMaterialDraft((current) => ({
      ...current,
      taskId,
      projectId: taskProjectIdFor(taskId, journal.tasks)
        ? ""
        : current.projectId
    }));
  }

  async function addNote() {
    if (!noteDraft.content.trim() || noteSaving) return;
    let tags: string[];
    try {
      tags = normalizeNoteTags(
        noteDraft.tags.split(",").map((tag) => tag.trim())
      );
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Note tags are invalid."
      );
      noteCreateWasInError.current = true;
      setAppAnnouncement("The note was not saved.");
      return;
    }
    const selectedTaskProjectId = taskProjectIdFor(
      noteDraft.taskId,
      journal.tasks
    );
    const expectedProjectId = selectedTaskProjectId
      ? null
      : noteDraft.projectId || null;
    const payload = {
      content: noteDraft.content.trim(),
      tags,
      taskId: noteDraft.taskId || null,
      projectId: noteDraft.projectId || null
    };
    const mutationId = mutationIdFor(noteCreateMutation, payload);
    setNoteSaving(true);
    try {
      const result = await createNoteRequest(payload, mutationId, expectedProjectId, data?.todayKey);

      setNoteDraft(emptyNoteCaptureDraft);
      noteCreateMutation.current = null;
      journal.noteHistory.refresh();
      journal.noteOptionHistory.refresh();
      setAppError("");
      if (noteCreateWasInError.current) {
        noteCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch (failure) {
      if (failure instanceof ApiError) {
        setAppError(
          failure.message
        );
        noteCreateWasInError.current = true;
        return;
      }

      setAppError("The note could not be saved. Your draft is still here.");
      noteCreateWasInError.current = true;
    } finally {
      setNoteSaving(false);
    }
  }

  async function addMaterial() {
    if (!materialDraft.url.trim() || materialSaving) return;
    const selectedTaskProjectId = taskProjectIdFor(
      materialDraft.taskId,
      journal.tasks
    );
    const expectedProjectId = selectedTaskProjectId
      ? null
      : materialDraft.projectId || null;
    const payload = {
      title: materialDraft.title.trim(),
      url: materialDraft.url.trim(),
      notes: materialDraft.notes.trim(),
      taskId: materialDraft.taskId || null,
      noteId: materialDraft.noteId || null,
      projectId: materialDraft.projectId || null
    };
    const mutationId = mutationIdFor(materialCreateMutation, payload);
    setMaterialSaving(true);
    try {
      const result = await createMaterialRequest(payload, mutationId, expectedProjectId);

      setMaterialDraft(emptyMaterialCaptureDraft);
      materialCreateMutation.current = null;
      journal.materialHistory.refresh();
      setAppError("");
      if (materialCreateWasInError.current) {
        materialCreateWasInError.current = false;
        setAppAnnouncement("Saved.");
      }
      await refreshAfterConfirmedMutation();
    } catch (failure) {
      if (failure instanceof ApiError) {
        setAppError(
          failure.message
        );
        materialCreateWasInError.current = true;
        return;
      }

      setAppError(
        "The reference could not be saved. Your draft is still here."
      );
      materialCreateWasInError.current = true;
    } finally {
      setMaterialSaving(false);
    }
  }

  async function saveDiary(diary: Diary) {
    try {
      const result = await saveDiaryRequest(diary);

      await refreshAfterConfirmedMutation();
      return true;
    } catch {
      return false;
    }
  }

  function reportDiarySaveFailure() {
    diarySaveWasInError.current = true;
    setAppAnnouncement("Journal was not saved.");
    setAppError("Couldn’t save the journal. Your writing is still here — retry.");
  }

  function reportDiarySaveRecovery() {
    if (!diarySaveWasInError.current) return;
    diarySaveWasInError.current = false;
    setAppAnnouncement("Saved.");
    setAppError("");
  }

  function setDiaryValue<K extends keyof Diary>(key: K, value: Diary[K]) {
    setData((current) =>
      current
        ? { ...current, diary: { ...current.diary, [key]: value } }
        : current
    );
  }

  return { selectNoteTask, selectMaterialTask, addNote, addMaterial, saveDiary, reportDiarySaveFailure, reportDiarySaveRecovery, setDiaryValue };
}
