import { parseLocalDate } from "@/shared/kernel/calendar";
import { requestErrors } from "@/shared/kernel/request-errors";
import { AppError, validation, type ErrorSpec } from "@/shared/kernel/errors";
import {
  has,
  parseBoundedInteger as kernelParseBoundedInteger,
  requireObject as kernelRequireObject,
  parseBoundedString,
  parseEnum,
  parseNullableLocalDate,
  parseRecordId,
  readJsonBody
} from "@/shared/kernel/parsing";

export const PROJECT_NAME_MAX_LENGTH = 500;
export const PROJECT_OUTCOME_MAX_LENGTH = 5_000;
export const PROJECT_ID_MAX_LENGTH = 191;
export const PROJECT_TARGET_DURATION_MAX = 10_000;
export const PROJECT_WEEKLY_BUDGET_MAX_MINUTES = 10_080;
export const PHASE_NAME_MAX_LENGTH = 500;
export const PHASE_SORT_ORDER_MAX = 2_147_483_647;

const projectDurationUnits = ["DAYS", "WEEKS"] as const;

export type ProjectStatusValue = (typeof projectStatuses)[number];
export type ProjectDurationUnitValue = (typeof projectDurationUnits)[number];
export type ProjectMutationErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "RELATIONSHIP_CONFLICT";

type JsonObject = Record<string, unknown>;

export type ProjectCreateMutation = {
  name: string;
  desiredOutcome: string;
  targetDate: Date | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnitValue | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatusValue;
};

export type ProjectPatchMutation = {
  data: {
    name?: string;
    desiredOutcome?: string;
    targetDate?: Date | null;
    targetDurationValue?: number | null;
    targetDurationUnit?: ProjectDurationUnitValue | null;
    weeklyMinutesBudget?: number | null;
    status?: ProjectStatusValue;
  };
  confirmCompletion: boolean;
};

export type PhaseCreateMutation = {
  name: string;
};

export type PhasePatchMutation = {
  name?: string;
  sortOrder?: number;
};

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as ProjectMutationRequestError };

export async function readProjectMutationBody(request: {
  json(): Promise<unknown>;
}): Promise<JsonObject> {
  const body = await readJsonBody(
    request,
    "body",
    requestErrors.invalidJson.message,
    () => new AppError(requestErrors.invalidJson)
  );
  return requireObject(body);
}

export function parseProjectPathId(
  value: unknown,
  field: "id" | "projectId" = "id",
  label = field === "projectId" ? "Project" : "Resource"
) {
  return parseRecordId(value, field, `${label} identifier is invalid.`, validationError, {
    maximumLength: PROJECT_ID_MAX_LENGTH,
    rejectControlCharacters: true
  });
}

export function parseProjectCreateMutation(
  value: unknown
): ProjectCreateMutation {
  const body = requireObject(value);
  const duration = parseTargetDuration(
    body.targetDurationValue,
    body.targetDurationUnit
  );

  return {
    name: parseRequiredText(
      body.name,
      "name",
      "Project name",
      PROJECT_NAME_MAX_LENGTH
    ),
    desiredOutcome: parseOptionalText(
      body.desiredOutcome,
      "desiredOutcome",
      "Desired outcome",
      PROJECT_OUTCOME_MAX_LENGTH
    ),
    targetDate: parseOptionalDate(body.targetDate),
    targetDurationValue: duration?.value ?? null,
    targetDurationUnit: duration?.unit ?? null,
    weeklyMinutesBudget: parseOptionalPositiveInteger(
      body.weeklyMinutesBudget,
      "weeklyMinutesBudget",
      PROJECT_WEEKLY_BUDGET_MAX_MINUTES,
      projectErrors.weeklyEffortBudgetMustBeAWholeNumberFrom1To.message
    ),
    status: has(body, "status") ? parseProjectMutationStatus(body.status) : "ACTIVE"
  };
}

export function parseProjectPatchMutation(
  value: unknown
): ProjectPatchMutation {
  const body = requireObject(value);
  const data: ProjectPatchMutation["data"] = {};

  if (has(body, "name")) {
    data.name = parseRequiredText(
      body.name,
      "name",
      "Project name",
      PROJECT_NAME_MAX_LENGTH
    );
  }
  if (has(body, "desiredOutcome")) {
    data.desiredOutcome = parseOptionalText(
      body.desiredOutcome,
      "desiredOutcome",
      "Desired outcome",
      PROJECT_OUTCOME_MAX_LENGTH
    );
  }
  if (has(body, "targetDate")) {
    data.targetDate = parseOptionalDate(body.targetDate);
  }
  if (has(body, "weeklyMinutesBudget")) {
    data.weeklyMinutesBudget = parseOptionalPositiveInteger(
      body.weeklyMinutesBudget,
      "weeklyMinutesBudget",
      PROJECT_WEEKLY_BUDGET_MAX_MINUTES,
      projectErrors.weeklyEffortBudgetMustBeAWholeNumberFrom1To.message
    );
  }
  if (has(body, "targetDurationValue") || has(body, "targetDurationUnit")) {
    const duration = parseTargetDuration(
      body.targetDurationValue,
      body.targetDurationUnit
    );
    data.targetDurationValue = duration?.value ?? null;
    data.targetDurationUnit = duration?.unit ?? null;
  }
  if (has(body, "status")) {
    data.status = parseProjectMutationStatus(body.status);
  }

  let confirmCompletion = false;
  if (has(body, "confirm")) {
    if (typeof body.confirm !== "boolean") {
      throw new AppError(projectErrors.completionConfirmationMustBeTrueOrFalse);
    }
    confirmCompletion = body.confirm;
  }

  return { data, confirmCompletion };
}

export function parsePhaseCreateMutation(value: unknown): PhaseCreateMutation {
  const body = requireObject(value);
  return {
    name: parseRequiredText(
      body.name,
      "name",
      "Phase name",
      PHASE_NAME_MAX_LENGTH
    )
  };
}

export function parsePhasePatchMutation(value: unknown): PhasePatchMutation {
  const body = requireObject(value);
  const data: PhasePatchMutation = {};

  if (has(body, "name")) {
    data.name = parseRequiredText(
      body.name,
      "name",
      "Phase name",
      PHASE_NAME_MAX_LENGTH
    );
  }
  if (has(body, "sortOrder")) {
    data.sortOrder = parseBoundedInteger(
      body.sortOrder,
      "sortOrder",
      0,
      PHASE_SORT_ORDER_MAX,
      projectErrors.phaseOrderMustBeAWholeNumberFrom0To2147483647.message
    );
  }

  return data;
}

function requireObject(value: unknown): JsonObject {
  return kernelRequireObject(
    value, "body", requestErrors.objectRequired.message, validationError
  );
}

function parseRequiredText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  return parseBoundedString(value, field, `${label} is required.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength} characters or fewer.`,
    emptyMessage: `${label} is required.`,
    trim: true
  });
}

function parseOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumLength: number
) {
  if (value === null || value === undefined) return "";
  return parseBoundedString(value, field, `${label} must be text.`, validationError, {
    maximumLength,
    lengthMessage: `${label} must be ${maximumLength} characters or fewer.`,
    trim: true
  });
}

function parseOptionalDate(value: unknown) {
  return parseNullableLocalDate(
    value,
    "targetDate",
    projectErrors.targetDateIsInvalid.message,
    validationError,
    {
      nullValues: [null, undefined, ""],
      trim: true,
      parseDate: parseLocalDate
    }
  );
}

function parseTargetDuration(value: unknown, unit: unknown) {
  const emptyValue = value === null || value === undefined || value === "";
  const emptyUnit = unit === null || unit === undefined || unit === "";
  if (emptyValue && emptyUnit) return null;

  const parsedValue = parseBoundedInteger(
    value,
    "targetDurationValue",
    1,
    PROJECT_TARGET_DURATION_MAX,
    projectErrors.targetDurationMustBeAWholeNumberFrom1To10000.message
  );
  return {
    value: parsedValue,
    unit: parseEnum(
      unit, projectDurationUnits, "targetDurationUnit",
      projectErrors.targetDurationUnitMustBeDAYSOrWEEKS.message, validationError,
      { normalize: (text) => text.trim().toUpperCase() }
    )
  };
}

function parseOptionalPositiveInteger(
  value: unknown,
  field: string,
  maximum: number,
  message: string
) {
  if (value === null || value === undefined || value === "") return null;
  return parseBoundedInteger(value, field, 1, maximum, message);
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  message: string
) {
  return kernelParseBoundedInteger(
    value, field, minimum, maximum, message, validationError
  );
}

function parseProjectMutationStatus(value: unknown): ProjectStatusValue {
  return parseEnum(
    value,
    projectStatuses,
    "status",
    projectErrors.projectStatusIsInvalid.message,
    validationError,
    {
      normalize: (text) => text.trim().toUpperCase()
    }
  );
}

function validationError(message: string, field: string) {
  return validation(message, field);
}

export const projectStatuses = ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectDurationUnit = "DAYS" | "WEEKS";

export type ProjectMetricTask = {
  status: string;
};

export type ProjectMetrics = {
  completedTaskCount: number;
  taskCount: number;
  progressPercent: number | null;
};

export type ProjectSummary = ProjectMetrics & {
  id: string;
  name: string;
  desiredOutcome: string;
  targetDate: string | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  phaseCount: number;
  backlogCount: number;
  investedMinutes: number;
  reviewPeriodInvestedMinutes: number;
  movedDuringReviewPeriod: boolean;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
  nextTaskEstimateMinutes: number | null;
  lastProgressAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPhaseRecord = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskRecord = {
  id: string;
  title: string;
  date: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  urgentScore: number;
  importanceScore: number;
  deadline: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  sortOrder: number;
  completedAt: string | null;
  projectId: string | null;
  phaseId: string | null;
};

export type ProjectActivityRecord = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  taskId: string | null;
  projectId: string | null;
};

export type ProjectNoteRecord = {
  id: string;
  content: string;
  tags: string[];
  taskId: string | null;
  projectId: string | null;
  date: string;
  createdAt: string;
};

export type ProjectMaterialRecord = {
  id: string;
  title: string;
  url: string;
  type: string;
  notes: string;
  taskId: string | null;
  projectId: string | null;
  createdAt: string;
};

export type ProjectDetail = ProjectSummary & {
  phases: ProjectPhaseRecord[];
  tasks: ProjectTaskRecord[];
  activities: ProjectActivityRecord[];
  notes: ProjectNoteRecord[];
  materials: ProjectMaterialRecord[];
};

export function calculateProjectMetrics(tasks: ProjectMetricTask[]): ProjectMetrics {
  const taskCount = tasks.length;
  const completedTaskCount = tasks.filter((task) => task.status === "DONE").length;

  return {
    completedTaskCount,
    taskCount,
    progressPercent: taskCount ? Math.round((completedTaskCount / taskCount) * 100) : null
  };
}

export function formatInvestedMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function projectStatusLabel(status: ProjectStatus) {
  const labels: Record<ProjectStatus, string> = {
    ACTIVE: "Active",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    ARCHIVED: "Archived"
  };
  return labels[status];
}

export function formatProjectDuration(
  value: number | null,
  unit: ProjectDurationUnit | null
) {
  if (!value || !unit) return "";
  const label =
    unit === "DAYS"
      ? value === 1
        ? "day"
        : "days"
      : value === 1
        ? "week"
        : "weeks";
  return `${value} ${label}`;
}


/** Exact envelopes owned by the project boundary. The serializer emits exactly the declared properties. */
export const projectErrors = {
  completionConfirmationMustBeTrueOrFalse: {
    status: 400,
    message: "Completion confirmation must be true or false.",
    code: "VALIDATION_ERROR",
    field: "confirm"
  },
  aTaskCannotHaveAPhaseWithoutAProject: {
    status: 400,
    message: "A task cannot have a phase without a project.",
    code: "VALIDATION_ERROR",
    field: "phaseId"
  },
  theSelectedProjectCouldNotBeFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "projectId"
  },
  reopenTheCompletedProjectBeforeAddingUnfinishedWork: {
    status: 409,
    message: "Reopen the completed project before adding unfinished work.",
    code: "RELATIONSHIP_CONFLICT",
    field: "projectId"
  },
  theSelectedPhaseCouldNotBeFound: {
    status: 404,
    message: "The selected phase could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "phaseId"
  },
  theSelectedPhaseDoesNotBelongToThisProject: {
    status: 409,
    message: "The selected phase does not belong to this project.",
    code: "RELATIONSHIP_CONFLICT",
    field: "phaseId"
  },
  phaseParentNotFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "NOT_FOUND",
    field: "projectId"
  },
  phaseNotFound: {
    status: 404,
    message: "Phase not found.",
    code: "NOT_FOUND"
  },
  phaseCouldNotBeDeleted: {
    status: 500,
    message: "Phase could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  phaseCouldNotBeSaved: {
    status: 500,
    message: "Phase could not be saved.",
    code: "INTERNAL_ERROR"
  },
  theSelectedProjectIsNoLongerAvailable: {
    status: 409,
    message: "The selected Project is no longer available.",
    code: "CONFLICT",
    field: "projectId"
  },
  phaseCouldNotBeCreated: {
    status: 500,
    message: "Phase could not be created.",
    code: "INTERNAL_ERROR"
  },
  projectDetailNotFound: {
    status: 404,
    message: "Project not found."
  },
  confirmCompletionWhileUnfinishedTasksRemain: {
    status: 409,
    message: "Confirm completion while unfinished tasks remain.",
    code: "CONFLICT",
    field: "status",
    requiresConfirmation: true
  },
  projectDeletionRequiresConfirmation: {
    status: 400,
    message: "Project deletion requires confirmation.",
    code: "VALIDATION_ERROR",
    field: "confirm"
  },
  projectNotFound: {
    status: 404,
    message: "Project not found.",
    code: "NOT_FOUND"
  },
  aRelatedRecordChangedBeforeTheProjectCouldBeSaved: {
    status: 409,
    message: "A related record changed before the Project could be saved.",
    code: "CONFLICT"
  },
  projectCouldNotBeDeleted: {
    status: 500,
    message: "Project could not be deleted.",
    code: "INTERNAL_ERROR"
  },
  projectCouldNotBeSaved: {
    status: 500,
    message: "Project could not be saved.",
    code: "INTERNAL_ERROR"
  },
  aRelatedRecordChangedBeforeTheProjectCouldBeCreated: {
    status: 409,
    message: "A related record changed before the Project could be created.",
    code: "CONFLICT"
  },
  projectCouldNotBeCreated: {
    status: 500,
    message: "Project could not be created.",
    code: "INTERNAL_ERROR"
  },
  weeklyEffortBudgetMustBeAWholeNumberFrom1To: {
    status: 400,
    message: "Weekly effort budget must be a whole number from 1 to 10080 minutes.",
    code: "VALIDATION_ERROR",
    field: "weeklyMinutesBudget"
  },
  projectIdentifierIsInvalid: {
    status: 400,
    message: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  phaseOrderMustBeAWholeNumberFrom0To2147483647: {
    status: 400,
    message: "Phase order must be a whole number from 0 to 2147483647.",
    code: "VALIDATION_ERROR",
    field: "sortOrder"
  },
  phaseIdentifierIsInvalid: {
    status: 400,
    message: "Phase identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "id"
  },
  projectIdentifierIsInvalidprojectId: {
    status: 400,
    message: "Project identifier is invalid.",
    code: "VALIDATION_ERROR",
    field: "projectId"
  },
  phaseNameIsRequired: {
    status: 400,
    message: "Phase name is required.",
    code: "VALIDATION_ERROR",
    field: "name"
  },
  targetDateIsInvalid: {
    status: 400,
    message: "Target date is invalid.",
    code: "VALIDATION_ERROR",
    field: "targetDate"
  },
  targetDurationMustBeAWholeNumberFrom1To10000: {
    status: 400,
    message: "Target duration must be a whole number from 1 to 10000.",
    code: "VALIDATION_ERROR",
    field: "targetDurationValue"
  },
  targetDurationUnitMustBeDAYSOrWEEKS: {
    status: 400,
    message: "Target duration unit must be DAYS or WEEKS.",
    code: "VALIDATION_ERROR",
    field: "targetDurationUnit"
  },
  projectStatusIsInvalid: {
    status: 400,
    message: "Project status is invalid.",
    code: "VALIDATION_ERROR",
    field: "status"
  }
} as const satisfies Record<string, ErrorSpec>;

export function parseProjectStatus(value: unknown): ProjectStatus | null {
  const status = String(value ?? "").toUpperCase();
  return projectStatuses.includes(status as ProjectStatus)
    ? (status as ProjectStatus)
    : null;
}

export { AppError as ProjectRuleError };

export type SummaryInput = {
  id: string;
  name: string;
  desiredOutcome: string;
  targetDate: Date | null;
  targetDurationValue: number | null;
  targetDurationUnit: ProjectDurationUnit | null;
  weeklyMinutesBudget: number | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  phases: Array<{ id: string }>;
  tasks: Array<{
    id: string;
    title: string;
    date: Date | null;
    status: "TODO" | "IN_PROGRESS" | "DONE";
    estimateMinutes: number;
    completedAt: Date | null;
  }>;
  attributedActivities: Array<{
    id: string;
    durationMinutes: number;
    startedAt: Date;
  }>;
};

/** Pure row composition shared by Review and the server project-summary read model.
 * Reads stay with the callers; grouping preserves each query's source order. */
export function summarizeProjects(
  projects: Array<Omit<SummaryInput, "tasks" | "attributedActivities">>,
  tasks: Array<SummaryInput["tasks"][number] & { projectId: string | null }>,
  activities: Array<SummaryInput["attributedActivities"][number] & { attributedProjectId: string | null }>,
  reviewPeriod: { start: Date; end: Date }
) {
  const tasksByProject = groupProjectRows(tasks, task => task.projectId);
  const activitiesByProject = groupProjectRows(activities, activity => activity.attributedProjectId);
  return projects.map(project => summarizeProject({
    ...project,
    tasks: tasksByProject.get(project.id) ?? [],
    attributedActivities: activitiesByProject.get(project.id) ?? []
  }, reviewPeriod));
}

function groupProjectRows<Row>(rows: Row[], projectId: (row: Row) => string | null) {
  const buckets = new Map<string, Row[]>();
  for (const row of rows) {
    const id = projectId(row);
    if (id === null) continue;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }
  return buckets;
}

export function summarizeProject(
  project: SummaryInput,
  reviewPeriod: { start: Date; end: Date }
) {
  const metrics = calculateProjectMetrics(project.tasks);
  const activities = project.attributedActivities;
  const investedMinutes = activities.reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );
  const reviewPeriodInvestedMinutes = activities
    .filter(
      (activity) =>
        activity.startedAt >= reviewPeriod.start &&
        activity.startedAt < reviewPeriod.end
    )
    .reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const movedDuringReviewPeriod =
    reviewPeriodInvestedMinutes > 0 ||
    project.tasks.some(
      (task) =>
        task.completedAt &&
        task.completedAt >= reviewPeriod.start &&
        task.completedAt < reviewPeriod.end
    );
  const nextTask =
    project.tasks
      .filter((task) => task.status !== "DONE")
      .sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
      })[0] ?? null;
  const progressDates = [
    ...activities.map((activity) => activity.startedAt),
    ...project.tasks.flatMap((task) => (task.completedAt ? [task.completedAt] : []))
  ];
  const lastProgressAt = progressDates.length
    ? new Date(Math.max(...progressDates.map((date) => date.getTime())))
    : null;

  return {
    id: project.id,
    name: project.name,
    desiredOutcome: project.desiredOutcome,
    targetDate: project.targetDate,
    targetDurationValue: project.targetDurationValue,
    targetDurationUnit: project.targetDurationUnit,
    weeklyMinutesBudget: project.weeklyMinutesBudget,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...metrics,
    phaseCount: project.phases.length,
    backlogCount: project.tasks.filter((task) => !task.date && task.status !== "DONE").length,
    investedMinutes,
    reviewPeriodInvestedMinutes,
    movedDuringReviewPeriod,
    nextTaskId: nextTask?.id ?? null,
    nextTaskTitle: nextTask?.title ?? null,
    nextTaskEstimateMinutes: nextTask?.estimateMinutes ?? null,
    lastProgressAt
  };
}


export function isProjectDetailResponse(value: unknown): value is ProjectDetail {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<ProjectDetail>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.desiredOutcome === "string" &&
    ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(
      String(project.status)
    ) &&
    Number.isInteger(project.completedTaskCount) &&
    Number.isInteger(project.taskCount) &&
    Number.isInteger(project.phaseCount) &&
    Number.isInteger(project.backlogCount) &&
    Number.isInteger(project.investedMinutes) &&
    Number.isInteger(project.reviewPeriodInvestedMinutes) &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    Array.isArray(project.phases) &&
    Array.isArray(project.tasks) &&
    Array.isArray(project.activities) &&
    Array.isArray(project.notes) &&
    Array.isArray(project.materials)
  );
}

export function isProjectPhaseResponse(value: unknown): value is ProjectPhaseRecord {
  if (!value || typeof value !== "object") return false;
  const phase = value as Partial<ProjectPhaseRecord>;
  return (
    typeof phase.id === "string" &&
    typeof phase.projectId === "string" &&
    typeof phase.name === "string" &&
    Number.isInteger(phase.sortOrder) &&
    typeof phase.createdAt === "string" &&
    typeof phase.updatedAt === "string"
  );
}

export function isProjectTaskResponse(value: unknown): value is ProjectTaskRecord {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ProjectTaskRecord>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    ["TODO", "IN_PROGRESS", "DONE"].includes(String(task.status)) &&
    ["LOW", "MEDIUM", "HIGH"].includes(String(task.priority)) &&
    Number.isInteger(task.urgentScore) &&
    Number.isInteger(task.importanceScore) &&
    (task.deadline === null || typeof task.deadline === "string") &&
    Number.isInteger(task.estimateMinutes) &&
    Number.isInteger(task.actualMinutes) &&
    Number.isInteger(task.sortOrder) &&
    (task.completedAt === null || typeof task.completedAt === "string") &&
    (task.projectId === null || typeof task.projectId === "string") &&
    (task.phaseId === null || typeof task.phaseId === "string")
  );
}

