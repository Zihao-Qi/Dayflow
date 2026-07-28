import assert from "node:assert/strict";
import test from "node:test";
import {
  MATERIAL_URL_MAX_LENGTH,
  NOTE_CONTENT_MAX_LENGTH
} from "../../src/lib/journal-domain";
import {
  PaletteSource,
  PaletteResolution,
  resolvePalette as resolvePaletteModule
} from "../../src/lib/command-palette";
import { TASK_TITLE_MAX_LENGTH } from "../../src/lib/task-mutations";

type ResultsResolution = Extract<PaletteResolution, { state: "results" }>;
type InvalidResolution = Extract<PaletteResolution, { state: "invalid" }>;
type TestPaletteSource = Omit<PaletteSource, "activeFocusTaskId"> &
  Partial<Pick<PaletteSource, "activeFocusTaskId">>;

function resolvePalette(source: TestPaletteSource) {
  const { activeFocusTaskId = null, ...rest } = source;
  return resolvePaletteModule({ ...rest, activeFocusTaskId });
}

function expectResults(resolution: PaletteResolution): ResultsResolution {
  assert.equal(resolution.state, "results");
  return resolution as ResultsResolution;
}

function expectInvalid(resolution: PaletteResolution): InvalidResolution {
  assert.equal(resolution.state, "invalid");
  assert.deepEqual(resolution.items, []);
  return resolution as InvalidResolution;
}

test("empty query returns fixed actions and deterministic Project suggestions", () => {
  const resolution = expectResults(
    resolvePalette({
      query: " \n\t ",
      tasks: [],
      projects: [
        { id: "z", name: "Zulu" },
        { id: "b", name: "Beta" },
        { id: "a", name: "Alpha" },
        { id: "d", name: "Delta" }
      ],
      hasActiveFocus: false
    })
  );

  assert.equal(resolution.normalizedQuery, "");
  assert.deepEqual(
    resolution.items.map((item) => item.id),
    [
      "action:start-focus",
      "action:draft-task",
      "action:draft-activity",
      "action:draft-note",
      "action:draft-reference",
      "project:a",
      "project:b",
      "project:d"
    ]
  );
  assert.deepEqual(resolution.items[0]?.intent, {
    kind: "start-focus",
    plannedMinutes: 50
  });
  assert.deepEqual(resolution.items[1]?.intent, {
    kind: "draft-task",
    title: null
  });
  assert.deepEqual(resolution.items[2]?.intent, { kind: "draft-activity" });
  assert.deepEqual(resolution.items[3]?.intent, {
    kind: "draft-note",
    content: null
  });
  assert.deepEqual(resolution.items[4]?.intent, {
    kind: "draft-reference",
    url: null
  });
});

test("active Focus Session changes the default action and Task matches queue", () => {
  const empty = expectResults(
    resolvePalette({
      query: "",
      tasks: [],
      projects: [],
      hasActiveFocus: true
    })
  );
  assert.equal(empty.items[0]?.id, "action:show-focus");
  assert.deepEqual(empty.items[0]?.intent, { kind: "show-focus" });

  const matching = expectResults(
    resolvePalette({
      query: "late",
      tasks: [{ id: "task-late", title: "Late Scheduled Task" }],
      projects: [],
      hasActiveFocus: true
    })
  );
  assert.deepEqual(matching.items[0]?.intent, {
    kind: "queue-task",
    taskId: "task-late"
  });
  assert.deepEqual(matching.items.at(-1)?.intent, {
    kind: "draft-task",
    title: "late"
  });
});

test("the Task already linked to active focus shows focus while other Tasks queue", () => {
  const resolution = expectResults(
    resolvePalette({
      query: "ship",
      tasks: [
        { id: "active-task", title: "Ship active work" },
        { id: "next-task", title: "Ship next work" }
      ],
      projects: [],
      hasActiveFocus: true,
      activeFocusTaskId: "active-task"
    })
  );

  const activeTask = resolution.items.find(
    (item) => item.id === "task:active-task"
  );
  const nextTask = resolution.items.find(
    (item) => item.id === "task:next-task"
  );
  assert.deepEqual(activeTask?.intent, { kind: "show-focus" });
  assert.equal(
    activeTask?.detail,
    "Show the Focus Session already linked to this Task"
  );
  assert.deepEqual(nextTask?.intent, {
    kind: "queue-task",
    taskId: "next-task"
  });
});

test("Task matches prepare Focus Session drafts when focus is idle", () => {
  const resolution = expectResults(
    resolvePalette({
      query: "repair",
      tasks: [{ id: "task-repair", title: "Repair the parser" }],
      projects: [],
      hasActiveFocus: false
    })
  );

  assert.deepEqual(resolution.items[0]?.intent, {
    kind: "focus-task",
    taskId: "task-repair",
    label: "Repair the parser"
  });
});

test("focus syntax accepts only whole minutes from 1 through 240", () => {
  for (const [query, plannedMinutes] of [
    ["focus 1", 1],
    ["focus 240", 240],
    [" ＦＯＣＵＳ　５０ ", 50]
  ] as const) {
    const resolution = expectResults(
      resolvePalette({
        query,
        tasks: [],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.equal(resolution.items.length, 1);
    assert.equal(resolution.items[0]?.id, "handoff:focus");
    assert.deepEqual(resolution.items[0]?.intent, {
      kind: "start-focus",
      plannedMinutes
    });
  }

  for (const query of ["focus words", "focus -1", "focus 1.5"]) {
    const resolution = expectInvalid(
      resolvePalette({
        query,
        tasks: [{ id: "focus-task", title: query }],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.equal(resolution.code, "FOCUS_MINUTES_NOT_INTEGER");
  }

  for (const query of ["focus 0", "focus 241"]) {
    const resolution = expectInvalid(
      resolvePalette({
        query,
        tasks: [],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.equal(resolution.code, "FOCUS_MINUTES_OUT_OF_RANGE");
  }
});

test("bare focus opens the appropriate default focus action", () => {
  const idle = expectResults(
    resolvePalette({
      query: "focus",
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(idle.items.map((item) => item.id), ["action:start-focus"]);

  const active = expectResults(
    resolvePalette({
      query: " FOCUS ",
      tasks: [],
      projects: [],
      hasActiveFocus: true
    })
  );
  assert.deepEqual(active.items.map((item) => item.id), ["action:show-focus"]);
});

test("explicit focus duration shows the current Focus Session when one is active", () => {
  const resolution = expectResults(
    resolvePalette({
      query: "focus 35",
      tasks: [],
      projects: [],
      hasActiveFocus: true
    })
  );

  assert.equal(resolution.items.length, 1);
  assert.equal(resolution.items[0]?.id, "action:show-focus");
  assert.equal(resolution.items[0]?.label, "Show current Focus Session");
  assert.equal(
    resolution.items[0]?.detail,
    "A Focus Session is already active; a 35m session was not started."
  );
  assert.deepEqual(resolution.items[0]?.intent, { kind: "show-focus" });
});

test("explicit and bare note queries produce direct note handoffs", () => {
  const explicit = expectResults(
    resolvePalette({
      query: "  NoTe   Keep \t the decision  ",
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(explicit.items[0]?.id, "handoff:note");
  assert.deepEqual(explicit.items[0]?.intent, {
    kind: "draft-note",
    content: "Keep \t the decision"
  });

  const bare = expectResults(
    resolvePalette({
      query: "note",
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(bare.items.map((item) => item.id), ["action:draft-note"]);
  assert.deepEqual(bare.items[0]?.intent, {
    kind: "draft-note",
    content: null
  });
});

test("valid HTTP(S) URLs hand off directly and URL-like mistakes stay invalid", () => {
  for (const query of [
    "https://example.com/reference",
    "http://example.test/path?q=dayflow"
  ]) {
    const resolution = expectResults(
      resolvePalette({
        query: `  ${query}  `,
        tasks: [],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.equal(resolution.items[0]?.id, "handoff:reference");
    assert.deepEqual(resolution.items[0]?.intent, {
      kind: "draft-reference",
      url: query
    });
  }

  for (const [query, code] of [
    ["https//example.com", "INVALID_URL"],
    ["https:/example.com", "INVALID_URL"],
    ["https:example.com", "INVALID_URL"],
    ["https://", "INVALID_URL"],
    ["www.example.com", "INVALID_URL"],
    ["mailto:alice@example.com", "UNSUPPORTED_URL_SCHEME"],
    ["tel:+15551234567", "UNSUPPORTED_URL_SCHEME"],
    ["file:/tmp/dayflow.txt", "UNSUPPORTED_URL_SCHEME"],
    ["ftp://example.com/file", "UNSUPPORTED_URL_SCHEME"],
    ["ftp:example.com/file", "UNSUPPORTED_URL_SCHEME"],
    ["ws://example.com/socket", "UNSUPPORTED_URL_SCHEME"],
    ["ws:example.com/socket", "UNSUPPORTED_URL_SCHEME"],
    ["gopher:example.com", "UNSUPPORTED_URL_SCHEME"],
    ["data:text/plain,dayflow", "UNSUPPORTED_URL_SCHEME"],
    ["javascript:alert(1)", "UNSUPPORTED_URL_SCHEME"]
  ] as const) {
    const resolution = expectInvalid(
      resolvePalette({
        query,
        tasks: [{ id: "same", title: query }],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.equal(resolution.code, code);
  }
});

test("ordinary colon text remains a Task handoff instead of becoming a URL error", () => {
  for (const query of ["Follow up: Alice", "Review: Alice"]) {
    const resolution = expectResults(
      resolvePalette({
        query,
        tasks: [],
        projects: [],
        hasActiveFocus: false
      })
    );
    assert.deepEqual(resolution.items.at(-1)?.intent, {
      kind: "draft-task",
      title: query
    });
  }
});

test("Task, note, and reference handoffs preserve raw trimmed draft text", () => {
  const rawTask = "Ｆｕｌｌ width e\u0301";
  const task = expectResults(
    resolvePalette({
      query: ` \u00a0${rawTask}\u3000 `,
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(task.items.at(-1)?.intent, {
    kind: "draft-task",
    title: rawTask
  });

  const rawNote = "Ｆｕｌｌ note e\u0301";
  const note = expectResults(
    resolvePalette({
      query: `  ＮＯＴＥ   ${rawNote}  `,
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(note.items[0]?.intent, {
    kind: "draft-note",
    content: rawNote
  });

  const rawUrl = "https://example.com/Ｒｅｆ/e\u0301";
  const reference = expectResults(
    resolvePalette({
      query: `  ${rawUrl}  `,
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(reference.items[0]?.intent, {
    kind: "draft-reference",
    url: rawUrl
  });
});

test("general queries rank actions, Tasks, and Projects deterministically", () => {
  const resolution = expectResults(
    resolvePalette({
      query: "  Plan  ",
      tasks: [
        { id: "task-substring", title: "Airplane checklist" },
        { id: "task-token", title: "Weekly plan review" },
        { id: "task-prefix", title: "Plan release" },
        { id: "task-exact", title: "Plan" }
      ],
      projects: [
        { id: "project-substring", name: "Airplane" },
        { id: "project-token", name: "Launch plan" },
        { id: "project-prefix", name: "Planning launch" },
        { id: "project-exact", name: "Plan" }
      ],
      hasActiveFocus: false
    })
  );

  assert.deepEqual(
    resolution.items.map((item) => item.id),
    [
      "task:task-exact",
      "project:project-exact",
      "task:task-prefix",
      "project:project-prefix",
      "task:task-token",
      "project:project-token",
      "task:task-substring",
      "project:project-substring",
      "handoff:task"
    ]
  );
  assert.deepEqual(resolution.items.at(-1)?.intent, {
    kind: "draft-task",
    title: "Plan"
  });

  const action = expectResults(
    resolvePalette({
      query: "activity",
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.deepEqual(action.items.map((item) => item.id), [
    "action:draft-activity",
    "handoff:task"
  ]);
});

test("Unicode and whitespace normalization affect matching without losing trimmed input", () => {
  const resolution = expectResults(
    resolvePalette({
      query: " \u00a0weekly\t  plan \n",
      tasks: [
        { id: "weekly", title: "Weekly Plan" },
        { id: "resume", title: "Résumé evidence" }
      ],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(resolution.normalizedQuery, "weekly plan");
  assert.equal(resolution.items[0]?.id, "task:weekly");
  assert.deepEqual(resolution.items.at(-1)?.intent, {
    kind: "draft-task",
    title: "weekly\t  plan"
  });

  const composed = expectResults(
    resolvePalette({
      query: "re\u0301sume\u0301",
      tasks: [{ id: "resume", title: "Résumé evidence" }],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(composed.items[0]?.id, "task:resume");
  assert.equal(composed.normalizedQuery, "résumé");
});

test("ordering and namespaced identities do not depend on source array order", () => {
  const tasks = Object.freeze([
    Object.freeze({ id: "b", title: "Ship beta" }),
    Object.freeze({ id: "a", title: "Ship alpha" }),
    Object.freeze({ id: "a", title: "Ship duplicate" })
  ]);
  const projects = Object.freeze([
    Object.freeze({ id: "p2", name: "Ship zeta" }),
    Object.freeze({ id: "p1", name: "Ship project" })
  ]);

  const first = expectResults(
    resolvePalette({
      query: "ship",
      tasks,
      projects,
      hasActiveFocus: false
    })
  );
  const second = expectResults(
    resolvePalette({
      query: "ship",
      tasks: [...tasks].reverse(),
      projects: [...projects].reverse(),
      hasActiveFocus: false
    })
  );

  assert.deepEqual(first.items, second.items);
  assert.ok(
    first.items.every((item) =>
      /^(?:action|task|project|handoff):/u.test(item.id)
    )
  );
  assert.equal(first.items.filter((item) => item.id === "task:a").length, 1);
});

test("handoff length violations are invalid and never fall back to Task creation", () => {
  const task = expectInvalid(
    resolvePalette({
      query: "x".repeat(TASK_TITLE_MAX_LENGTH + 1),
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(task.code, "TASK_TITLE_TOO_LONG");

  const note = expectInvalid(
    resolvePalette({
      query: `note ${"x".repeat(NOTE_CONTENT_MAX_LENGTH + 1)}`,
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(note.code, "NOTE_TOO_LONG");

  const url = expectInvalid(
    resolvePalette({
      query: `https://example.com/${"x".repeat(MATERIAL_URL_MAX_LENGTH)}`,
      tasks: [],
      projects: [],
      hasActiveFocus: false
    })
  );
  assert.equal(url.code, "URL_TOO_LONG");
});
