import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHabitHistory } from "../../src/modules/evidence/ui/use-habit-history";

const habitId = "habit-1";
const expired = "2026-09-19";
const today = "2026-09-26";
const nextToday = "2026-09-27";
const nextEarliest = "2026-09-20";

function habit() {
  return {
    id: habitId,
    name: "Reading",
    cadence: "DAILY",
    targetPerWeek: 7,
    status: "ACTIVE",
    sortOrder: 0,
    createdAt: "2026-09-01T12:00:00.000Z",
    archivedAt: null,
    createdDay: "2026-09-01",
    archivedDay: null
  };
}

function row(day: string, note: string) {
  return {
    id: `row-${day}`,
    habitId,
    date: `${day}T05:00:00.000Z`,
    day,
    done: true,
    amount: 0,
    note
  };
}

function history(bounds: { earliest: string; today: string }, checkIns: ReturnType<typeof row>[]) {
  return {
    todayKey: bounds.today,
    earliestDate: bounds.earliest,
    latestDate: bounds.today,
    habits: [habit()],
    checkIns
  };
}

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

function json(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  };
}

test("reconcile on a rolled window loads the new days and keeps the expired fact", async () => {
  const host = installDocument();
  const historyCalls: string[] = [];
  let releaseNextWindow: ((response: ReturnType<typeof json>) => void) | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/habits/history") {
      historyCalls.push(path);
      if (historyCalls.length === 1) {
        return json(history({ earliest: expired, today }, [row(expired, "before"), row(today, "old today")]));
      }
      return await new Promise<ReturnType<typeof json>>((resolve) => {
        releaseNextWindow = resolve;
      });
    }
    if (path === `/api/habits/${habitId}/check-in?date=${expired}`) {
      return json({
        todayKey: nextToday,
        earliestDate: nextEarliest,
        latestDate: nextToday,
        habitId,
        date: expired,
        checkIn: row(expired, "expired fact")
      });
    }
    if (path === `/api/habits/${habitId}/check-in`) {
      return json({ error: "lost" }, false);
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof fetch;

  const seen: { current: ReturnType<typeof useHabitHistory> | null } = { current: null };
  function Probe() {
    const history = useHabitHistory({ initialTodayKey: expired });
    useEffect(() => {
      seen.current = history;
    });
    return null;
  }
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(createElement(Probe));
    });
    const api = () => {
      if (!seen.current) throw new Error("hook did not render");
      return seen.current;
    };
    await act(async () => {
      api().openHistory();
    });
    assert.equal(historyCalls.length, 1);
    await act(async () => {
      api().setDraft(habitId, expired, { note: "still drafting", touchedNote: true });
    });
    let save: { ok: boolean } | undefined;
    await act(async () => {
      save = await api().saveCheckIn(habitId, expired);
    });
    assert.equal(save?.ok, false);
    const pendingBefore = api().pendingMutations.get(`${habitId}:${expired}`);
    assert.equal(pendingBefore?.isUncertain, true);
    await act(async () => {
      await api().reconcileRecord(habitId, expired);
    });
    assert.equal(historyCalls.length, 2, "rollover reconciliation fetches the complete new window");
    assert.equal(api().selectedDate, expired);
    assert.equal(api().historyData?.todayKey, nextToday);
    assert.equal(api().historyData?.checkIns.find((item) => item.day === nextToday), undefined);
    assert.equal(api().getDraft(habitId, expired).note, "still drafting");
    assert.equal(api().pendingMutations.get(`${habitId}:${expired}`)?.mutationId, pendingBefore?.mutationId);
    assert.equal(releaseNextWindow === null, false);
    await act(async () => {
      releaseNextWindow?.(json(history(
        { earliest: nextEarliest, today: nextToday },
        [row(nextToday, "new today"), row(today, "current")]
      )));
    });
    assert.equal(api().historyData?.checkIns.find((item) => item.day === nextToday)?.note, "new today");
    assert.equal(api().historyData?.checkIns.find((item) => item.day === expired)?.note, "expired fact");
    assert.equal(api().selectedDate, expired);
    assert.equal(api().getDraft(habitId, expired).note, "still drafting");
    assert.equal(api().pendingMutations.get(`${habitId}:${expired}`)?.mutationId, pendingBefore?.mutationId);
    assert.equal(api().pendingMutations.get(`${habitId}:${expired}`)?.isUncertain, true);
    assert.equal(api().pendingMutations.get(`${habitId}:${expired}`)?.isSaving, false);
    await act(async () => {
      await api().reconcileRecord(habitId, expired);
    });
    assert.equal(historyCalls.length, 2, "the same window does not fetch history again");
  } finally {
    await act(async () => {
      root?.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});
