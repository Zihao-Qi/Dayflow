import type { ProjectDetail, ProjectPhaseRecord, ProjectTaskRecord } from "@/lib/project-domain";
import { request } from "@/shared/client/api-client";
import {
  isLegacyProjectDetail,
  isOkResponse,
  isProjectDetailResponse,
  isProjectPhaseResponse,
  isProjectPlanResponse,
  isProjectTaskResponse,
  type ProjectPatch
} from "@/shared/client/decoders";

export function updateProject(id: string, patch: ProjectPatch) {
  return request(`/api/projects/${id}`, {
    method: "PATCH",
    body: patch,
    decode: (result): result is ProjectDetail => !(!isProjectDetailResponse(result)),
    fallback: "Project could not be updated. Your edits are still here.",
  });
}

export function deleteProject(id: string) {
  return request(`/api/projects/${id}?confirm=true`, {
    method: "DELETE",
    decode: (result): result is {
      ok: true;
    } => !(!isOkResponse(result)),
    fallback: "Project could not be deleted.",
  });
}

export function createProject(payload: {
  name: string;
  desiredOutcome: string;
  targetDate: string | null;
  targetDurationValue: number | null;
  targetDurationUnit: string | null;
  weeklyMinutesBudget: number | null;
}, mutationId: string) {
  return request("/api/projects", {
    method: "POST",
    body: payload,
    mutationId: mutationId,
    decode: (body): body is ProjectDetail => !(!isProjectDetailResponse(body) ||
      body.name !== payload.name.trim() ||
      body.desiredOutcome !== payload.desiredOutcome.trim()),
    fallback: "Project could not be created. Your draft is still here.",
  });
}

export function loadProjectPlan(id: string) {
  return request(`/api/projects/${id}`, {
    cache: "no-store",
    decode: (result): result is {
      tasks: ProjectTaskRecord[];
      phases?: unknown;
    } => !(!isProjectPlanResponse(result)),
    fallback: "unavailable",
  });
}

export function renamePhase(id: string, name: string) {
  return request(`/api/phases/${id}`, {
    method: "PATCH",
    body: { name },
    decode: (result): result is ProjectPhaseRecord => !(!isProjectPhaseResponse(result) ||
      result.id !== id ||
      result.name !== name),
    fallback: "Couldn’t save the phase name. Your text is still here — retry.",
  });
}

export function loadProjectDetail(id: string) {
  return request(`/api/projects/${id}`, {
    cache: "no-store",
    strictJson: true,
    decode: isLegacyProjectDetail,
    fallback: "Project could not be opened.",
    useEnvelopeMessage: false
  });
}

const CHANGE_FAILURE = "The change could not be saved. Your draft is still here.";
export function createPhase(projectId: string, payload: {
  name: string;
}, mutationId: string) {
  return request(`/api/projects/${projectId}/phases`, {
    method: "POST", body: payload, mutationId,
    decode: (value): value is ProjectPhaseRecord => isProjectPhaseResponse(value) && value.projectId === projectId && value.name === payload.name.trim(),
    fallback: CHANGE_FAILURE
  });
}

export function createProjectTask(payload: {
  title: string;
  projectId: string;
  phaseId: string | null;
  date: null;
  estimateMinutes: number;
}, mutationId: string) {
  return request("/api/tasks", {
    method: "POST", body: payload, mutationId,
    decode: (value): value is ProjectTaskRecord => isProjectTaskResponse(value) && value.title === payload.title.trim() && value.projectId === payload.projectId && value.phaseId === payload.phaseId,
    fallback: CHANGE_FAILURE
  });
}

export function updateProjectTask(id: string, patch: Partial<ProjectTaskRecord> & {
  scheduleSource?: string;
}) {
  return request(`/api/tasks/${id}`, {
    method: "PATCH", body: patch,
    decode: (value): value is ProjectTaskRecord => isProjectTaskResponse(value) && value.id === id,
    fallback: CHANGE_FAILURE
  });
}

export function deleteProjectTask(id: string) {
  return request(`/api/tasks/${id}`, { method: "DELETE", decode: isOkResponse, fallback: CHANGE_FAILURE });
}

export function deletePhase(id: string) {
  return request(`/api/phases/${id}`, { method: "DELETE", decode: isOkResponse, fallback: CHANGE_FAILURE });
}
