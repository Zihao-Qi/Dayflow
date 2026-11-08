import assert from "node:assert/strict";
import test from "node:test";
import { createNote, type NoteCreatePayload } from "../../src/modules/journal/ui/api";
import type { JournalNoteRecord } from "../../src/modules/journal/ui/journal-model";
import { ApiError } from "../../src/shared/client/api-client";

const payload: NoteCreatePayload = {
  content: "Preserved Note intent", tags: ["retry"],
  taskId: "task", projectId: "project", date: "2026-09-04"
};
const saved: JournalNoteRecord = {
  id: "note", ...payload,
  date: "2026-09-04T00:00:00-05:00", createdAt: "2026-09-04T23:59:59-05:00"
};

for (const [label, taskId, requestedProject, canonicalProject] of [
  ["committed direct Project receipt after Task assignment", "task", "project", "project"],
  ["first commit normalized after same-Project Task assignment", "task", "project", null],
  ["Task without a requested direct Project", "task", null, null],
  ["direct Project without a Task", null, "project", "project"],
  ["neither Task nor Project", null, null, null]
] as const) {
  test(`Note client accepts ${label} on the original intended day`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T00:01:00-05:00") });
    const result = { ...saved, taskId, projectId: canonicalProject };
    const calls: Array<{ path: RequestInfo | URL; init?: RequestInit }> = [];
    t.mock.method(globalThis, "fetch", async (path: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path, init });
      return Response.json(result, { status: 201 });
    });
    const intent = { ...payload, taskId, projectId: requestedProject };
    assert.deepEqual(await createNote(intent, "stable-note-id"), result);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/notes");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), intent);
    assert.equal((calls[0].init?.headers as Record<string, string>)["X-Dayflow-Mutation-Id"], "stable-note-id");
  });
}

for (const [label, intent, changed] of [
  ["no Task cannot lose its direct Project", { ...payload, taskId: null }, { taskId: null, projectId: null }],
  ["no Task cannot change its direct Project", { ...payload, taskId: null }, { taskId: null, projectId: "unrelated" }],
  ["Task cannot gain an unrelated direct Project", payload, { projectId: "unrelated" }],
  ["no requested Project cannot gain one", { ...payload, projectId: null }, { projectId: "project" }],
  ["Task must match", payload, { taskId: "other-task" }],
  ["content must match", payload, { content: "Other writing" }],
  ["tags must match", payload, { tags: ["other"] }],
  ["intended day must match", payload, { date: "2026-09-05T00:00:00-05:00" }],
  ["date must be valid", payload, { date: "not-a-date" }],
  ["record shape must be complete", payload, { createdAt: undefined }]
] as const) {
  test(`Note client rejects canonical mismatch: ${label}`, async (t) => {
    const result = { ...saved, ...changed };
    t.mock.method(globalThis, "fetch", async () => Response.json(result, { status: 201 }));
    await assert.rejects(createNote(intent, "stable-note-id"), (error: unknown) => {
      assert.ok(error instanceof ApiError, label);
      assert.equal(error.kind, "decode", label);
      assert.equal(error.status, 201, label);
      return true;
    }, label);
  });
}
