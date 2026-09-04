import { expect, test, type Page } from "@playwright/test";
import { addLocalDays, localDateKey } from "./activity-date-helpers";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function bootstrap(page: Page) {
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    todayKey: string;
    tasks: Array<{ id: string; title: string; date: string | null }>;
  };
}

async function createTask(page: Page, title: string, date: string) {
  const response = await page.request.post("/api/tasks", {
    data: { title, date }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

async function openToday(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.locator(".today-page")).toBeVisible({ timeout: 30_000 });
}

const openRows = (page: Page) => page.locator(".next-section .task-row");

for (const disposition of ["today", "another day", "backlog"] as const) {
  test(`unfinished task moves to ${disposition} and its schedule can be undone`, async ({ page }) => {
    const { todayKey } = await bootstrap(page);
    const yesterday = addLocalDays(todayKey, -1);
    const tomorrow = addLocalDays(todayKey, 1);
    const task = await createTask(page, "Unfinished decision", yesterday);
    await openToday(page);
    const carry = page.locator(".carry-over-strip");
    await expect(carry).toContainText("Unfinished decision");

    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/tasks/${task.id}` &&
      response.request().method() === "PATCH"
    );
    if (disposition === "today") {
      await carry.getByRole("button", { name: "Do it today", exact: true }).click();
    } else if (disposition === "another day") {
      await carry.getByLabel("Pick a day for Unfinished decision").fill(tomorrow);
    } else {
      await carry.getByRole("button", { name: "Unschedule", exact: true }).click();
    }
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({
      date: disposition === "today" ? todayKey : disposition === "another day" ? tomorrow : null,
      scheduleSource: disposition === "today" ? "unfinished-to-today" : disposition === "another day" ? "unfinished-date-picker" : "unfinished-to-backlog"
    });
    await expect(carry).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".today-page")).toBeVisible();
    await expect(carry).toHaveCount(0);
    const persisted = (await bootstrap(page)).tasks.find(({ id }) => id === task.id);
    expect(persisted).toBeDefined();
    expect(persisted!.date === null ? null : localDateKey(persisted!.date)).toBe(
      disposition === "today" ? todayKey : disposition === "another day" ? tomorrow : null
    );
    await expect(openRows(page)).toHaveCount(disposition === "today" ? 1 : 0);
    if (disposition === "backlog") {
      await expect(page.locator(".later-section").getByRole("button", { name: /Unfinished decision/ })).toBeVisible();
    }

    // Today has no Undo control. Exercise the existing schedule-undo API,
    // then reload to characterize how the restored date appears in Today.
    const undo = await page.request.post(`/api/tasks/${task.id}/schedule/undo`);
    expect(undo.ok()).toBe(true);
    expect(localDateKey((await undo.json()).date)).toBe(yesterday);
    await page.reload();
    await expect(carry).toContainText("Unfinished decision");
    await expect(openRows(page)).toHaveCount(0);
  });
}

test("leaving an unfinished task in place survives navigation but resets on reload", async ({ page }) => {
  const { todayKey } = await bootstrap(page);
  const yesterday = addLocalDays(todayKey, -1);
  const task = await createTask(page, "Leave this decision", yesterday);
  await openToday(page);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`/api/tasks/${task.id}`) && request.method() !== "GET") {
      mutations.push(request.method());
    }
  });
  const carry = page.locator(".carry-over-strip");
  await carry.getByRole("button", { name: /^Leave on / }).click();
  await expect(carry).toHaveCount(0);
  await page.getByRole("button", { name: /^Backlog/ }).click();
  await expect(page.locator(".backlog-page")).toBeVisible();
  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(page.locator(".today-page")).toBeVisible();
  await expect(carry).toHaveCount(0);
  expect(localDateKey((await bootstrap(page)).tasks.find(({ id }) => id === task.id)!.date!)).toBe(yesterday);
  expect(mutations).toEqual([]);
  await page.reload();
  await expect(carry).toContainText("Leave this decision");

  // Dismissal is local state, so it creates no schedule change to undo.
  const undo = await page.request.post(`/api/tasks/${task.id}/schedule/undo`);
  expect(undo.status()).toBe(404);
  expect(await undo.json()).toMatchObject({ field: "scheduleChange" });
});

test("dragging from the reorder handle persists the new order after reload", async ({ page }) => {
  const { todayKey } = await bootstrap(page);
  for (const title of ["First drag task", "Second drag task", "Third drag task"]) {
    await createTask(page, title, todayKey);
  }
  await openToday(page);
  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  const source = page.getByRole("article", { name: "Task: First drag task", exact: true });
  const target = page.getByRole("article", { name: "Task: Third drag task", exact: true });
  await source.locator(".drag-handle").hover();
  await expect(source).toHaveAttribute("draggable", "true");
  const reordered = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/tasks/reorder" && response.request().method() === "POST"
  );
  await source.locator(".drag-handle").dragTo(target);
  expect((await reordered).ok()).toBe(true);
  const titles = page.locator(".next-section .task-title-input");
  const expected = ["Second drag task", "Third drag task", "First drag task"];
  await expect.poll(() => titles.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  )).toEqual(expected);
  await page.reload();
  await expect.poll(() => titles.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  )).toEqual(expected);
});

for (const trigger of ["blur", "Enter", "debounce"] as const) {
  test(`inline title edits save on ${trigger}, with visible save state and no per-keystroke write`, async ({ page }) => {
    const { todayKey } = await bootstrap(page);
    const task = await createTask(page, "Original title", todayKey);
    await openToday(page);
    // Hold browser timers so network latency cannot accidentally turn a blur
    // or Enter test into a test of the existing 600ms autosave.
    const clockStart = new Date();
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
    let releaseSave = () => {};
    const held = new Promise<void>((resolve) => { releaseSave = resolve; });
    const writes: unknown[] = [];
    await page.route(`**/api/tasks/${task.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      writes.push(route.request().postDataJSON());
      await held;
      await route.continue();
    });
    const title = page.locator(".next-section .task-title-input");
    await title.fill("");
    await title.pressSequentially("Edited title");
    await page.clock.runFor(599);
    expect(writes).toEqual([]);
    expect((await bootstrap(page)).tasks.find(({ id }) => id === task.id)?.title).toBe("Original title");
    if (trigger === "blur") await title.blur();
    else if (trigger === "Enter") await title.press("Enter");
    else await page.clock.runFor(1);
    const chip = page.locator(".next-section .task-save-state");
    try {
      await expect(chip).toHaveText("Saving");
      await expect.poll(() => writes).toEqual([{ title: "Edited title" }]);
    } finally {
      releaseSave();
    }
    await expect(chip).toHaveText("Saved");
    await page.clock.runFor(601);
    expect(writes).toEqual([{ title: "Edited title" }]);
    await page.reload();
    await expect(title).toHaveValue("Edited title");
  });
}

// Existing coverage intentionally retained rather than duplicated:
// dayflow.spec.ts: "persists task editing, completion, and accessible ordering"
// covers the completed group, reopening, Enter's Saved chip and button reorder.
// first-run-onboarding.spec.ts: "hands the first-task draft to Projects and back
// without losing it" and "opens Capture with focus and restores the onboarding
// control on Escape" cover both first-run handoffs and their focus return.
