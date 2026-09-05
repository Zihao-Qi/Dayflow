import {
  csvExportFileName,
  isCsvExportKind,
  type CsvExportKind
} from "@/lib/csv-export-contract";
import { csvExportErrors } from "@/lib/csv-export-errors";
import { localDateKey } from "@/lib/dates";
import { AppError } from "@/shared/kernel/errors";
import type { Prisma } from "@prisma/client";

export type CsvExportResult = {
  kind: CsvExportKind;
  fileName: string;
  body: string;
  recordCount: number;
};

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export { AppError as CsvExportError };

type CsvExportDatabase = Pick<Prisma.TransactionClient, "task" | "activityEntry">;
type CsvValue = string | number | null;
type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => CsvValue;
};

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  date: true,
  deadline: true,
  estimateMinutes: true,
  actualMinutes: true,
  urgentScore: true,
  importanceScore: true,
  sortOrder: true,
  focusQueuePosition: true,
  completedAt: true,
  projectId: true,
  phaseId: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { name: true } },
  phase: { select: { name: true } }
} satisfies Prisma.TaskSelect;

const activitySelect = {
  id: true,
  startedAt: true,
  durationMinutes: true,
  category: true,
  note: true,
  origin: true,
  taskId: true,
  projectId: true,
  attributedProjectId: true,
  focusSessionId: true,
  createdAt: true,
  updatedAt: true,
  task: { select: { title: true } },
  project: { select: { name: true } },
  attributedProject: { select: { name: true } }
} satisfies Prisma.ActivityEntrySelect;

type TaskExportRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type ActivityExportRow = Prisma.ActivityEntryGetPayload<{
  select: typeof activitySelect;
}>;

const taskColumns: ReadonlyArray<CsvColumn<TaskExportRow>> = [
  { header: "task_id", value: (task) => task.id },
  { header: "title", value: (task) => task.title },
  { header: "status", value: (task) => task.status },
  { header: "priority", value: (task) => task.priority },
  {
    header: "scheduled_date",
    value: (task) => optionalLocalDate(task.date)
  },
  {
    header: "deadline_date",
    value: (task) => optionalLocalDate(task.deadline)
  },
  {
    header: "estimate_minutes",
    value: (task) => task.estimateMinutes
  },
  {
    header: "legacy_actual_minutes",
    value: (task) => task.actualMinutes
  },
  { header: "urgent_score", value: (task) => task.urgentScore },
  {
    header: "importance_score",
    value: (task) => task.importanceScore
  },
  { header: "sort_order", value: (task) => task.sortOrder },
  {
    header: "focus_queue_position",
    value: (task) => task.focusQueuePosition
  },
  {
    header: "completed_at_utc",
    value: (task) => optionalIso(task.completedAt)
  },
  { header: "project_id", value: (task) => task.projectId },
  {
    header: "project_name",
    value: (task) => task.project?.name ?? null
  },
  { header: "phase_id", value: (task) => task.phaseId },
  {
    header: "phase_name",
    value: (task) => task.phase?.name ?? null
  },
  {
    header: "created_at_utc",
    value: (task) => task.createdAt.toISOString()
  },
  {
    header: "updated_at_utc",
    value: (task) => task.updatedAt.toISOString()
  }
];

function activityColumns(
  timezone: string
): ReadonlyArray<CsvColumn<ActivityExportRow>> {
  return [
    { header: "activity_id", value: (activity) => activity.id },
    {
      header: "started_at_utc",
      value: (activity) => activity.startedAt.toISOString()
    },
    {
      header: "local_date",
      value: (activity) => localDateKey(activity.startedAt)
    },
    {
      header: "local_start_time",
      value: (activity) => localTime(activity.startedAt)
    },
    { header: "timezone", value: () => timezone },
    {
      header: "duration_minutes",
      value: (activity) => activity.durationMinutes
    },
    { header: "category", value: (activity) => activity.category },
    { header: "note", value: (activity) => activity.note },
    { header: "origin", value: (activity) => activity.origin },
    { header: "task_id", value: (activity) => activity.taskId },
    {
      header: "task_title",
      value: (activity) => activity.task?.title ?? null
    },
    {
      header: "direct_project_id",
      value: (activity) => activity.projectId
    },
    {
      header: "direct_project_name",
      value: (activity) => activity.project?.name ?? null
    },
    {
      header: "attributed_project_id",
      value: (activity) => activity.attributedProjectId
    },
    {
      header: "attributed_project_name",
      value: (activity) => activity.attributedProject?.name ?? null
    },
    {
      header: "focus_session_id",
      value: (activity) => activity.focusSessionId
    },
    {
      header: "created_at_utc",
      value: (activity) => activity.createdAt.toISOString()
    },
    {
      header: "updated_at_utc",
      value: (activity) => activity.updatedAt.toISOString()
    }
  ];
}

export function parseCsvExportKind(value: unknown): CsvExportKind {
  if (!isCsvExportKind(value)) {
    throw new AppError(csvExportErrors.exportNotFound);
  }
  return value;
}

export async function createCsvExport(
  kind: CsvExportKind,
  now: Date,
  database: CsvExportDatabase
): Promise<CsvExportResult> {
  const fileDate = localDateKey(now);
  if (kind === "tasks") {
    const tasks = await database.task.findMany({
      select: taskSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return {
      kind,
      fileName: csvExportFileName(kind, fileDate),
      body: serializeCsv(taskColumns, tasks),
      recordCount: tasks.length
    };
  }

  const activities = await database.activityEntry.findMany({
    select: activitySelect,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }]
  });
  return {
    kind,
    fileName: csvExportFileName(kind, fileDate),
    body: serializeCsv(
      activityColumns(resolveTimezone()),
      activities
    ),
    recordCount: activities.length
  };
}

function serializeCsv<Row>(
  columns: ReadonlyArray<CsvColumn<Row>>,
  rows: Row[]
) {
  const records = [
    columns.map((column) => encodeCsvCell(column.header)).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => encodeCsvCell(column.value(row)))
        .join(",")
    )
  ];
  return `\uFEFF${records.join("\r\n")}\r\n`;
}

function encodeCsvCell(value: CsvValue) {
  if (value === null) return "";
  const text =
    typeof value === "string"
      ? makeFormulaSafe(value)
      : String(value);
  return /[",\r\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function makeFormulaSafe(value: string) {
  return /^[\p{Cc}\p{Z}\s]*[=+\-@]/u.test(value)
    ? `'${value}`
    : value;
}

function optionalLocalDate(value: Date | null) {
  return value ? localDateKey(value) : null;
}

function optionalIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function localTime(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;
}

function resolveTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
