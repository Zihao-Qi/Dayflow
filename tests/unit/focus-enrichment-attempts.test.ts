import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FocusSessionProvider, useFocusSession } from "../../src/components/focus-session-provider";

function snapshot(id: string | null) {
  return { active: null, pendingCompletion: id === null ? null : {
    id, kind: "FOCUS", plannedMinutes: 25, actualMinutes: 25, label: "Work",
    startedAt: "2026-10-13T09:35:00Z", pausedAt: null, accumulatedPauseSeconds: 0,
    status: "COMPLETED", completedAt: "2026-10-13T10:00:00Z", needsEnrichment: true,
    enrichedAt: null, completionNote: null, completionCategory: null,
    taskId: "task-1", projectId: null,
    task: { id: "task-1", title: "Work", projectId: null, project: null, phase: null }, project: null
  }, today: { completedSessions: 1, focusedMinutes: 25 } };
}

// Minimal DOM adapter, matching the existing headless React hook tests. No browser/server.
function installDocument() {
  function node(name = "div") {
    const el: {
      nodeType: number;
      nodeName: string;
      tagName: string;
      style: Record<string, string>;
      childNodes: unknown[];
      ownerDocument: unknown;
      parentNode: unknown;
      textContent: string;
      addEventListener: () => void;
      removeEventListener: () => void;
      appendChild: (child: { parentNode: unknown }) => unknown;
      removeChild: (child: unknown) => unknown;
      insertBefore: (child: { parentNode: unknown }) => unknown;
      contains: () => boolean;
      setAttribute: () => void;
      getAttribute: () => null;
      removeAttribute: () => void;
      focus: () => void;
    } = {
      nodeType: 1,
      nodeName: name.toUpperCase(),
      tagName: name.toUpperCase(),
      style: {},
      childNodes: [],
      ownerDocument: null,
      parentNode: null,
      textContent: "",
      addEventListener() {},
      removeEventListener() {},
      appendChild(child) {
        el.childNodes.push(child);
        child.parentNode = el;
        return child;
      },
      removeChild(child) {
        el.childNodes = el.childNodes.filter((item) => item !== child);
        return child;
      },
      insertBefore(child) {
        return el.appendChild(child);
      },
      contains() {
        return false;
      },
      setAttribute() {},
      getAttribute() {
        return null;
      },
      removeAttribute() {},
      focus() {}
    };
    return el;
  }
  class HTMLIFrameElement {}
  Object.defineProperty(globalThis, "HTMLIFrameElement", { value: HTMLIFrameElement, configurable: true });
  Object.defineProperty(globalThis, "HTMLElement", { value: class HTMLElement {}, configurable: true });
  Object.defineProperty(globalThis, "Element", { value: class Element {}, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: class Node { static ELEMENT_NODE = 1; }, configurable: true });
  const body = node("body");
  const document = {
    nodeType: 9,
    documentElement: node("html"),
    body,
    head: node("head"),
    defaultView: globalThis,
    visibilityState: "visible",
    createElement: (name: string) => {
      const created = node(name);
      created.ownerDocument = document;
      return created;
    },
    createElementNS: (_namespace: string, name: string) => document.createElement(name),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text, parentNode: null }),
    addEventListener() {},
    removeEventListener() {},
    activeElement: body
  };
  body.ownerDocument = document;
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  const host = document.createElement("div");
  body.appendChild(host);
  return host;
}


test("actual provider/API retains an enrichment intent across errors, separates edits, and clears on confirmation", async () => {
  const globals = ["HTMLIFrameElement", "HTMLElement", "Element", "Node", "document", "window", "IS_REACT_ACT_ENVIRONMENT", "sessionStorage"];
  const descriptors = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const host = installDocument();
  // The provider only removes this key in this scenario; no persistent fixture storage.
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: () => null, removeItem: () => undefined, setItem: () => undefined
  } });
  const originalFetch = globalThis.fetch;
  let pendingId = "session-1";
  let confirmEnrichment = false;
  const calls: { path: string; id: string | null; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, options?: RequestInit) => {
    const path = String(input);
    if (!options?.method) return Response.json(snapshot(pendingId));
    const body = JSON.parse(String(options.body));
    const id = new Headers(options.headers).get("X-Dayflow-Mutation-Id");
    calls.push({ path, id, body });
    if (path === "/api/focus-session") return Response.json({ error: "Next start failed" }, { status: 500 });
    if (!confirmEnrichment) throw new Error("lost enrichment response");
    return Response.json({ completed: true, enriched: true, suggestedBreakMinutes: 5, completedSession: null, snapshot: snapshot(null) });
  }) as typeof fetch;
  const seen: { current: ReturnType<typeof useFocusSession> | null } = { current: null };
  function Probe() {
    const focus = useFocusSession();
    useEffect(() => { seen.current = focus; });
    return null;
  }
  const api = () => { assert.ok(seen.current); return seen.current; };
  let root: Root | null = null;
  const intent = { note: "Finished", category: "Learning", taskCompleted: true, next: null };
  async function save(input: Parameters<ReturnType<typeof useFocusSession>["enrichCompletion"]>[0]) {
    let result: boolean | undefined;
    await act(async () => { result = await api().enrichCompletion(input); });
    assert.equal(result, false);
    return calls.at(-1)!;
  }
  try {
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(createElement(FocusSessionProvider, null, createElement(Probe)));
    });
    assert.equal(api().pendingCompletion?.id, pendingId);
    const first = await save(intent);
    assert.ok(first.id, "enrichment must carry a durable mutation identifier");
    assert.equal(first.body.action, "enrich");
    const retry = await save({ ...intent, note: " Finished ", category: " Learning ", next: { kind: "BREAK", plannedMinutes: 5 } });
    assert.equal(retry.id, first.id, "same normalized enrichment keeps its ID even if next-session choice changes");
    assert.deepEqual(retry.body, first.body, "retry sends the retained canonical payload");
    const noteEdit = await save({ ...intent, note: "Changed" });
    assert.notEqual(noteEdit.id, retry.id);
    const taskEdit = await save({ ...intent, note: "Changed", taskCompleted: false });
    assert.notEqual(taskEdit.id, noteEdit.id);
    const categoryEdit = await save({ ...intent, note: "Changed", taskCompleted: false, category: "Admin" });
    assert.notEqual(categoryEdit.id, taskEdit.id);
    pendingId = "session-2";
    await act(async () => { assert.equal(await api().reload(), true); });
    const sessionEdit = await save({ ...intent, note: "Changed", taskCompleted: false, category: "Admin" });
    assert.notEqual(sessionEdit.id, categoryEdit.id, "session identity is part of the retained intent");
    assert.equal(sessionEdit.path, "/api/focus-session/session-2");
    confirmEnrichment = true;
    await save({ ...intent, note: "Changed", taskCompleted: false, category: "Admin", next: { kind: "BREAK", plannedMinutes: 5 } });
    assert.equal(calls.at(-2)?.id, sessionEdit.id, "confirmed retry still uses the original enrichment intent");
    assert.equal(api().pendingCompletion, null, "next-start failure must not undo confirmed enrichment");
    // A later intentional handoff, even with equal fields, must not reuse a confirmed intent.
    await act(async () => { assert.equal(await api().reload(), true); });
    confirmEnrichment = false;
    const later = await save({ ...intent, note: "Changed", taskCompleted: false, category: "Admin" });
    assert.notEqual(later.id, sessionEdit.id, "confirmation clears enrichment attempt before the separate next start");
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
