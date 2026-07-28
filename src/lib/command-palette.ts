import {
  MATERIAL_URL_MAX_LENGTH,
  NOTE_CONTENT_MAX_LENGTH
} from "@/lib/journal-domain";
import { TASK_TITLE_MAX_LENGTH } from "@/lib/task-mutations";

export type PaletteTask = Readonly<{
  id: string;
  title: string;
}>;

export type PaletteProject = Readonly<{
  id: string;
  name: string;
}>;

export type PaletteSource = Readonly<{
  query: string;
  tasks: readonly PaletteTask[];
  projects: readonly PaletteProject[];
  hasActiveFocus: boolean;
  activeFocusTaskId: string | null;
}>;

export type PaletteIntent =
  | Readonly<{ kind: "show-focus" }>
  | Readonly<{ kind: "start-focus"; plannedMinutes: number }>
  | Readonly<{ kind: "focus-task"; taskId: string; label: string }>
  | Readonly<{ kind: "queue-task"; taskId: string }>
  | Readonly<{ kind: "draft-task"; title: string | null }>
  | Readonly<{ kind: "draft-activity" }>
  | Readonly<{ kind: "draft-note"; content: string | null }>
  | Readonly<{ kind: "draft-reference"; url: string | null }>
  | Readonly<{ kind: "open-project"; projectId: string }>;

export type PaletteItem = Readonly<{
  id: string;
  group: "action" | "task" | "project" | "handoff";
  label: string;
  detail?: string;
  intent: PaletteIntent;
}>;

export type PaletteInvalidCode =
  | "FOCUS_MINUTES_NOT_INTEGER"
  | "FOCUS_MINUTES_OUT_OF_RANGE"
  | "INVALID_URL"
  | "UNSUPPORTED_URL_SCHEME"
  | "TASK_TITLE_TOO_LONG"
  | "NOTE_TOO_LONG"
  | "URL_TOO_LONG";

export type PaletteResolution =
  | Readonly<{
      state: "results";
      normalizedQuery: string;
      items: readonly PaletteItem[];
    }>
  | Readonly<{
      state: "invalid";
      normalizedQuery: string;
      code: PaletteInvalidCode;
      message: string;
      items: readonly [];
    }>;

type SearchableAction = Readonly<{
  item: PaletteItem;
  aliases: readonly string[];
}>;

type RankedItem = Readonly<{
  item: PaletteItem;
  matchRank: number;
  groupRank: number;
  labelKey: string;
}>;

type UrlInterpretation =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "valid"; url: string }>
  | Readonly<{
      kind: "invalid";
      code: Extract<
        PaletteInvalidCode,
        "INVALID_URL" | "UNSUPPORTED_URL_SCHEME" | "URL_TOO_LONG"
      >;
      message: string;
    }>;

const EMPTY_PROJECT_LIMIT = 3;

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalid(
  normalizedQuery: string,
  code: PaletteInvalidCode,
  message: string
): PaletteResolution {
  return {
    state: "invalid",
    normalizedQuery,
    code,
    message,
    items: []
  };
}

function results(
  normalizedQuery: string,
  items: readonly PaletteItem[]
): PaletteResolution {
  return { state: "results", normalizedQuery, items };
}

function defaultFocusAction(hasActiveFocus: boolean): SearchableAction {
  return hasActiveFocus
    ? {
        item: {
          id: "action:show-focus",
          group: "action",
          label: "Show current Focus Session",
          intent: { kind: "show-focus" }
        },
        aliases: ["focus", "show focus", "timer", "current focus"]
      }
    : {
        item: {
          id: "action:start-focus",
          group: "action",
          label: "Start a 50m Focus Session",
          intent: { kind: "start-focus", plannedMinutes: 50 }
        },
        aliases: ["focus", "start focus", "timer", "focus 50"]
      };
}

function staticActions(hasActiveFocus: boolean): readonly SearchableAction[] {
  return [
    defaultFocusAction(hasActiveFocus),
    {
      item: {
        id: "action:draft-task",
        group: "action",
        label: "New Task for today",
        intent: { kind: "draft-task", title: null }
      },
      aliases: ["task", "new task", "add task", "today"]
    },
    {
      item: {
        id: "action:draft-activity",
        group: "action",
        label: "Log an activity by hand",
        intent: { kind: "draft-activity" }
      },
      aliases: ["activity", "record activity", "log activity", "time"]
    },
    {
      item: {
        id: "action:draft-note",
        group: "action",
        label: "Write a note",
        intent: { kind: "draft-note", content: null }
      },
      aliases: ["note", "write note", "journal"]
    },
    {
      item: {
        id: "action:draft-reference",
        group: "action",
        label: "Save a reference",
        intent: { kind: "draft-reference", url: null }
      },
      aliases: ["reference", "save reference", "url", "link", "material"]
    }
  ];
}

function uniqueSortedTasks(tasks: readonly PaletteTask[]) {
  const sorted = [...tasks].sort(
    (left, right) =>
      compareText(normalizedText(left.title), normalizedText(right.title)) ||
      compareText(left.title, right.title) ||
      compareText(left.id, right.id)
  );
  const seen = new Set<string>();
  return sorted.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

function uniqueSortedProjects(projects: readonly PaletteProject[]) {
  const sorted = [...projects].sort(
    (left, right) =>
      compareText(normalizedText(left.name), normalizedText(right.name)) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id)
  );
  const seen = new Set<string>();
  return sorted.filter((project) => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

function projectItem(project: PaletteProject): PaletteItem {
  return {
    id: `project:${project.id}`,
    group: "project",
    label: project.name,
    detail: "Open Project",
    intent: { kind: "open-project", projectId: project.id }
  };
}

function taskItem(
  task: PaletteTask,
  hasActiveFocus: boolean,
  activeFocusTaskId: string | null
): PaletteItem {
  const isActiveFocusTask =
    hasActiveFocus && task.id === activeFocusTaskId;
  return {
    id: `task:${task.id}`,
    group: "task",
    label: task.title,
    detail: isActiveFocusTask
      ? "Show the Focus Session already linked to this Task"
      : hasActiveFocus
        ? "Add Unfinished Task to the focus queue"
        : "Focus on Unfinished Task",
    intent: isActiveFocusTask
      ? { kind: "show-focus" }
      : hasActiveFocus
        ? { kind: "queue-task", taskId: task.id }
        : { kind: "focus-task", taskId: task.id, label: task.title }
  };
}

function handoffItem(
  kind: "focus",
  label: string,
  intent: Extract<PaletteIntent, { kind: "start-focus" }>
): PaletteItem;
function handoffItem(
  kind: "note",
  label: string,
  intent: Extract<PaletteIntent, { kind: "draft-note" }>
): PaletteItem;
function handoffItem(
  kind: "reference",
  label: string,
  intent: Extract<PaletteIntent, { kind: "draft-reference" }>
): PaletteItem;
function handoffItem(
  kind: "task",
  label: string,
  intent: Extract<PaletteIntent, { kind: "draft-task" }>
): PaletteItem;
function handoffItem(
  kind: "focus" | "note" | "reference" | "task",
  label: string,
  intent: PaletteIntent
): PaletteItem {
  return {
    id: `handoff:${kind}`,
    group: "handoff",
    label,
    intent
  };
}

function matchRank(candidate: string, query: string) {
  const key = normalizedText(candidate);
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  if (key.split(" ").some((token) => token.startsWith(query))) return 2;
  if (key.includes(query)) return 3;
  return null;
}

function bestActionRank(action: SearchableAction, query: string) {
  let best: number | null = matchRank(action.item.label, query);
  for (const alias of action.aliases) {
    const rank = matchRank(alias, query);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function interpretUrl(
  parsingQuery: string,
  rawTrimmedQuery: string
): UrlInterpretation {
  const scheme =
    /^([a-z][a-z0-9+.-]*):/iu.exec(parsingQuery)?.[1]?.toLowerCase();
  const hasSchemeSlashes =
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(parsingQuery);
  const hasSchemePayload =
    /^[a-z][a-z0-9+.-]*:\S/iu.test(parsingQuery);
  const isKnownUnsupportedScheme =
    scheme === "mailto" ||
    scheme === "tel" ||
    scheme === "file" ||
    scheme === "javascript" ||
    scheme === "data" ||
    scheme === "vbscript";
  if (
    scheme &&
    scheme !== "http" &&
    scheme !== "https" &&
    (hasSchemeSlashes || hasSchemePayload || isKnownUnsupportedScheme)
  ) {
    return {
      kind: "invalid",
      code: "UNSUPPORTED_URL_SCHEME",
      message: "References must use an http:// or https:// URL."
    };
  }

  if (scheme === "http" || scheme === "https") {
    if (!/^https?:\/\//iu.test(parsingQuery)) {
      return {
        kind: "invalid",
        code: "INVALID_URL",
        message: "Enter a complete http:// or https:// URL."
      };
    }
    if (rawTrimmedQuery.length > MATERIAL_URL_MAX_LENGTH) {
      return {
        kind: "invalid",
        code: "URL_TOO_LONG",
        message: `Reference URLs must be ${MATERIAL_URL_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`
      };
    }
    try {
      const url = new URL(rawTrimmedQuery);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        !url.hostname
      ) {
        throw new TypeError("URL must include an HTTP(S) host.");
      }
      return { kind: "valid", url: rawTrimmedQuery };
    } catch {
      return {
        kind: "invalid",
        code: "INVALID_URL",
        message: "Enter a complete http:// or https:// URL."
      };
    }
  }

  const looksLikeMalformedUrl =
    /^https?\/{1,2}/iu.test(parsingQuery) ||
    /^www\./iu.test(parsingQuery) ||
    /^[^\s/:?#]+\.[^\s/:?#]{2,}(?:[/:?#].*)?$/iu.test(parsingQuery);
  if (looksLikeMalformedUrl) {
    return {
      kind: "invalid",
      code: "INVALID_URL",
      message: "Enter a complete http:// or https:// URL."
    };
  }

  return { kind: "none" };
}

function compareRanked(left: RankedItem, right: RankedItem) {
  return (
    left.matchRank - right.matchRank ||
    left.groupRank - right.groupRank ||
    compareText(left.labelKey, right.labelKey) ||
    compareText(left.item.id, right.item.id)
  );
}

export function resolvePalette(source: PaletteSource): PaletteResolution {
  const rawTrimmedQuery = source.query.trim();
  const parsingQuery = rawTrimmedQuery.normalize("NFKC");
  const normalizedQuery = normalizedText(rawTrimmedQuery);
  const actions = staticActions(source.hasActiveFocus);

  if (!normalizedQuery) {
    const projectSuggestions = uniqueSortedProjects(source.projects)
      .slice(0, EMPTY_PROJECT_LIMIT)
      .map(projectItem);
    return results(normalizedQuery, [
      ...actions.map((action) => action.item),
      ...projectSuggestions
    ]);
  }

  const focusMatch = /^focus(?:\s+(.+))?$/iu.exec(parsingQuery);
  if (focusMatch) {
    const minutesText = focusMatch[1]?.trim();
    if (!minutesText) {
      return results(normalizedQuery, [
        defaultFocusAction(source.hasActiveFocus).item
      ]);
    }
    if (!/^[0-9]+$/u.test(minutesText)) {
      return invalid(
        normalizedQuery,
        "FOCUS_MINUTES_NOT_INTEGER",
        "Focus duration must be a whole number of minutes from 1 to 240."
      );
    }
    const plannedMinutes = Number(minutesText);
    if (plannedMinutes < 1 || plannedMinutes > 240) {
      return invalid(
        normalizedQuery,
        "FOCUS_MINUTES_OUT_OF_RANGE",
        "Focus duration must be from 1 to 240 minutes."
      );
    }
    if (source.hasActiveFocus) {
      return results(normalizedQuery, [
        {
          ...defaultFocusAction(true).item,
          detail: `A Focus Session is already active; a ${plannedMinutes}m session was not started.`
        }
      ]);
    }
    return results(normalizedQuery, [
      handoffItem(
        "focus",
        `Start a ${plannedMinutes}m Focus Session`,
        { kind: "start-focus", plannedMinutes }
      )
    ]);
  }

  const noteMatch = /^note(?:\s+([\s\S]+))?$/iu.exec(parsingQuery);
  if (noteMatch) {
    const rawNoteMatch =
      /^[^\s]+(?:\s+([\s\S]+))?$/u.exec(rawTrimmedQuery);
    const content = rawNoteMatch?.[1]?.trim() || null;
    if (content !== null && content.length > NOTE_CONTENT_MAX_LENGTH) {
      return invalid(
        normalizedQuery,
        "NOTE_TOO_LONG",
        `Notes must be ${NOTE_CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`
      );
    }
    if (content === null) {
      return results(normalizedQuery, [
        actions.find((action) => action.item.id === "action:draft-note")!.item
      ]);
    }
    return results(normalizedQuery, [
      handoffItem("note", `Write note: ${content}`, {
        kind: "draft-note",
        content
      })
    ]);
  }

  const url = interpretUrl(parsingQuery, rawTrimmedQuery);
  if (url.kind === "invalid") {
    return invalid(normalizedQuery, url.code, url.message);
  }
  if (url.kind === "valid") {
    return results(normalizedQuery, [
      handoffItem("reference", `Save reference: ${url.url}`, {
        kind: "draft-reference",
        url: url.url
      })
    ]);
  }

  if (rawTrimmedQuery.length > TASK_TITLE_MAX_LENGTH) {
    return invalid(
      normalizedQuery,
      "TASK_TITLE_TOO_LONG",
      `Task titles must be ${TASK_TITLE_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`
    );
  }

  const ranked: RankedItem[] = [];
  for (const action of actions) {
    const rank = bestActionRank(action, normalizedQuery);
    if (rank !== null) {
      ranked.push({
        item: action.item,
        matchRank: rank,
        groupRank: 0,
        labelKey: normalizedText(action.item.label)
      });
    }
  }
  for (const task of uniqueSortedTasks(source.tasks)) {
    const rank = matchRank(task.title, normalizedQuery);
    if (rank !== null) {
      const item = taskItem(
        task,
        source.hasActiveFocus,
        source.activeFocusTaskId
      );
      ranked.push({
        item,
        matchRank: rank,
        groupRank: 1,
        labelKey: normalizedText(item.label)
      });
    }
  }
  for (const project of uniqueSortedProjects(source.projects)) {
    const rank = matchRank(project.name, normalizedQuery);
    if (rank !== null) {
      const item = projectItem(project);
      ranked.push({
        item,
        matchRank: rank,
        groupRank: 2,
        labelKey: normalizedText(item.label)
      });
    }
  }

  ranked.sort(compareRanked);
  return results(normalizedQuery, [
    ...ranked.map((entry) => entry.item),
    handoffItem("task", `Create Task: ${rawTrimmedQuery}`, {
      kind: "draft-task",
      title: rawTrimmedQuery
    })
  ]);
}
