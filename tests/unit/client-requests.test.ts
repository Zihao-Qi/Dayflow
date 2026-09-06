import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, request } from "../../src/shared/client/api-client";
import { mutationIdFor, type PendingMutation } from "../../src/shared/client/mutation-ids";
import { loadBootstrap, saveReview } from "../../src/components/dashboard-api";
import { createTask, deleteTask, reorderTasks, saveTimeBlock } from "../../src/modules/planning/ui/api";
import { createBackup, downloadCsv, stageRestore } from "../../src/modules/data-ops/ui/api";
import { loadProjectDetail } from "../../src/modules/projects/ui/api";
import { startFocus } from "../../src/modules/focus/ui/api";
import type { Task } from "../../src/modules/planning/ui/backlog-model";

const task: Task = {
  id: "task-1", title: "Write", date: null, status: "TODO", priority: "MEDIUM",
  urgentScore: 1, importanceScore: 1, deadline: null, estimateMinutes: 30,
  actualMinutes: 0, sortOrder: 0, focusQueuePosition: null, completedAt: null,
  projectId: null, phaseId: null
};
const isOk = (value: unknown): value is { ok: true } =>
  Boolean(value && typeof value === "object" && "ok" in value && value.ok === true);

test("client transport preserves JSON, mutation headers, bodyless deletes and bootstrap cache", async (t) => {
  const calls: Array<{ path: unknown; init: RequestInit | undefined }> = [];
  let response = Response.json(task, { status: 201 });
  t.mock.method(globalThis, "fetch", async (path: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path, init });
    return response;
  });
  const payload = { title: "Write", date: null, estimateMinutes: 30 };
  assert.deepEqual(await createTask(payload, "retry-id"), task);
  assert.deepEqual(calls[0], {
    path: "/api/tasks", init: {
      method: "POST", body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", "X-Dayflow-Mutation-Id": "retry-id" }
    }
  });
  response = Response.json({ ok: true });
  await deleteTask("task-1");
  assert.deepEqual(calls[1], { path: "/api/tasks/task-1", init: { method: "DELETE" } });
  response = Response.json({ ok: true, tasks: [task] });
  await reorderTasks([task]);
  assert.equal(calls[2].init?.body, '{"ids":["task-1"]}');
  response = Response.json({});
  await assert.rejects(loadBootstrap(), { status: 200, code: "INVALID_BOOTSTRAP_RESPONSE" });
  assert.deepEqual(calls[3], { path: "/api/bootstrap", init: { cache: "no-store" } });
});

test("malformed or mismatched successes fail and envelope metadata survives", async (t) => {
  let response = Response.json({ ...task, title: "Different" });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(createTask({ title: "Write", date: null, estimateMinutes: 30 }, "id"), {
    name: "ApiError", status: 200, kind: "decode", message: "Your task was not saved. Your draft is still here."
  });
  response = new Response("not json", { status: 200 });
  await assert.rejects(request("/test", { decode: isOk, fallback: "Invalid" }), {
    name: "ApiError", status: 200, message: "Invalid"
  });
  response = Response.json({ code: "VALIDATION_ERROR", error: "Choose an end time.", field: "endTime" }, { status: 400 });
  await assert.rejects(saveTimeBlock(null, { date: "2026-09-04", title: "Write", startTime: "10:00", endTime: "09:00", taskId: null }, "id"), {
    status: 400, code: "VALIDATION_ERROR", message: "Choose an end time.", field: "endTime"
  });
  response = Response.json({ code: "REVIEW_PERIOD_CHANGED", error: "Period changed" }, { status: 409 });
  await assert.rejects(saveReview({ periodStart: "a", periodEnd: "b", narrative: "", nextPeriodIntention: "" }), {
    status: 409, code: "REVIEW_PERIOD_CHANGED"
  });
});

test("backup mutations retain the local action header and distinct invalid-success errors", async (t) => {
  const calls: RequestInit[] = [];
  let response = Response.json({ error: "Do not display this malformed success" });
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    return response;
  });
  await assert.rejects(createBackup(), {
    message: "Dayflow returned an invalid backup result. Refresh before relying on this backup."
  });
  assert.deepEqual(calls[0], {
    method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", "X-Dayflow-Local-Action": "1" }
  });
  response = Response.json({ error: "Backup changed" }, { status: 409 });
  await assert.rejects(stageRestore("backup-1", "a".repeat(64)), { message: "Backup changed" });
  assert.equal(calls[1].body, JSON.stringify({ backupId: "backup-1", expectedPayloadSha256: "a".repeat(64), confirmation: "RESTORE" }));
});

test("CSV validates headers before reading a successful blob and parses JSON errors", async (t) => {
  let response = new Response("csv", { headers: { "Content-Type": "text/csv" } });
  const readBlob = t.mock.method(response, "blob");
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(downloadCsv("tasks"), { message: "Dayflow returned an invalid Task CSV. Try again." });
  assert.equal(readBlob.mock.callCount(), 0);
  response = Response.json({ error: "Export unavailable" }, { status: 503 });
  await assert.rejects(downloadCsv("tasks"), { status: 503, message: "Export unavailable" });
  response = new Response("task_id\r\n", { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="dayflow-tasks-2026-09-04.csv"',
    "X-Dayflow-Export-Format": "dayflow-csv", "X-Dayflow-Export-Kind": "tasks",
    "X-Dayflow-Export-Version": "1", "X-Dayflow-File-Name": "dayflow-tasks-2026-09-04.csv",
    "X-Dayflow-Record-Count": "0"
  } });
  const result = await downloadCsv("tasks");
  assert.equal(result.metadata.recordCount, 0);
  assert.equal(await result.blob.text(), "task_id\r\n");
});

test("legacy Project reads retain fixed HTTP errors, unchecked JSON and syntax errors", async (t) => {
  let response = Response.json({ error: "Ignore this envelope" }, { status: 500 });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(loadProjectDetail("p"), { message: "Project could not be opened." });
  response = Response.json({ legacy: true });
  assert.deepEqual(await loadProjectDetail("p"), { legacy: true });
  response = new Response("not json");
  await assert.rejects(loadProjectDetail("p"), SyntaxError);
});

test("focus start forwards its existing idempotent payload and aborts remain caller-owned", async (t) => {
  const controller = new AbortController();
  const networkError = new TypeError("Network unavailable");
  const calls: Array<RequestInit | undefined> = [];
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    throw networkError;
  });
  const payload = { kind: "FOCUS" as const, plannedMinutes: 25, label: "Write", taskId: null, projectId: null };
  await assert.rejects(startFocus({ payload, mutationId: "focus-id", fingerprint: JSON.stringify(payload) }), (error) => error === networkError);
  assert.equal(calls[0]?.body, JSON.stringify(payload));
  assert.equal((calls[0]?.headers as Record<string, string>)["X-Dayflow-Mutation-Id"], "focus-id");
  await assert.rejects(request("/test", { signal: controller.signal, decode: isOk, fallback: "Failure" }), (error) => !(error instanceof ApiError) && error === networkError);
  assert.equal(calls[1]?.signal, controller.signal);
});

test("mutation ids persist across failed attempts and change only for a different payload or explicit clear", async (t) => {
  let nextId = 0;
  t.mock.method(globalThis.crypto, "randomUUID", () => `test-${++nextId}`);
  const reference: { current: PendingMutation | null } = { current: null };
  const first = mutationIdFor(reference, { title: "Write" });
  assert.equal(mutationIdFor(reference, { title: "Write" }), first);
  const edited = mutationIdFor(reference, { title: "Edited" });
  assert.notEqual(edited, first);
  reference.current = null;
  assert.notEqual(mutationIdFor(reference, { title: "Edited" }), edited);
});

test("Journal history owns its endpoint and decoder while preserving query and abort options", async (t) => {
  const { loadJournalHistory } = await import("../../src/modules/journal/ui/api");
  const signal = new AbortController().signal;
  const query = new URLSearchParams({ limit: "50", q: "a b", tag: "work", cursor: "cursor+1" });
  let call: { path: RequestInfo | URL; init?: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (path: RequestInfo | URL, init?: RequestInit) => {
    call = { path, init };
    return Response.json({ items: [{ id: "malformed" }], nextCursor: null, totalCount: 1 });
  });
  await assert.rejects(loadJournalHistory("note", query, signal), { message: "Note history could not be loaded." });
  assert.deepEqual(call, {
    path: "/api/notes?limit=50&q=a+b&tag=work&cursor=cursor%2B1",
    init: { cache: "no-store", signal }
  });
  await assert.rejects(loadJournalHistory("material", new URLSearchParams({ limit: "50" }), signal), {
    message: "Reference history could not be loaded."
  });
  assert.equal(call?.path, "/api/materials?limit=50");
});
