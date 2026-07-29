export const taskHeaders = [
  "task_id",
  "title",
  "status",
  "priority",
  "scheduled_date",
  "deadline_date",
  "estimate_minutes",
  "legacy_actual_minutes",
  "urgent_score",
  "importance_score",
  "sort_order",
  "focus_queue_position",
  "completed_at_utc",
  "project_id",
  "project_name",
  "phase_id",
  "phase_name",
  "created_at_utc",
  "updated_at_utc"
];

export const activityHeaders = [
  "activity_id",
  "started_at_utc",
  "local_date",
  "local_start_time",
  "timezone",
  "duration_minutes",
  "category",
  "note",
  "origin",
  "task_id",
  "task_title",
  "direct_project_id",
  "direct_project_name",
  "attributed_project_id",
  "attributed_project_name",
  "focus_session_id",
  "created_at_utc",
  "updated_at_utc"
];

export function parseCsv(body: string) {
  const source = body.startsWith("\uFEFF") ? body.slice(1) : body;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(cell);
      cell = "";
    } else if (character === "\r" && source[index + 1] === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new Error("CSV test document has an unterminated quoted cell.");
  }
  if (cell || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records;
}
