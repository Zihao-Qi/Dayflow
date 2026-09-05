import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, setFocusSessionElapsedMinutes } from "./database";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function openToday(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await expect(page.locator(".today-page")).toBeVisible();
}
test.beforeEach(() => resetTestDatabase());

test("Today waits for its day read and can retry an initial failure", async ({ page }) => {
  const held = barrier();
  const release = barrier();
  let requests = 0;
  await page.route("**/api/day?*", async (route) => {
    requests++;
    if (requests !== 1) return route.continue();
    held.release();
    await release.promise;
    await route.fulfill({ status: 503, json: { error: "Day offline" } });
  });
  await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await held.promise;
  await expect(page.getByText("Loading today…", { exact: true })).toBeVisible();
  await expect(page.getByText("The day is clear.", { exact: true })).toHaveCount(0);
  release.release();
  await expect(page.locator(".app-shell").getByRole("alert")).toContainText("That day could not be loaded");
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".today-page")).toBeVisible();
  expect(requests).toBe(2);
});

test("bootstrap failure still refreshes Today after a saved mutation", async ({ page }) => {
  await openToday(page);
  const reads: string[] = [];
  await page.route("**/api/day?*", async (route) => {
    reads.push(new URL(route.request().url()).searchParams.get("date")!);
    const response = await route.fetch();
    const json = await response.json();
    expect(json.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Saved despite bootstrap failure" })
    ]));
    await route.fulfill({ response, json });
  });
  await page.route("**/api/bootstrap", (route) => route.fulfill({ status: 503, json: { error: "Bootstrap offline" } }));
  await page.locator("#new-task").fill("Saved despite bootstrap failure");
  await page.locator("#new-task").press("Enter");
  await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: Saved despite bootstrap failure", exact: true })).toHaveValue("Saved despite bootstrap failure");
  await expect(page.locator(".app-shell").getByRole("alert")).toContainText("Your change was saved");
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  expect(reads).toEqual([todayKey]);
});

test("a failed day refresh keeps an accepted task create visible with saved-refresh-failed feedback", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  await page.request.post("/api/tasks", { data: { title: "Accepted task", date: todayKey } });
  await openToday(page);
  await page.route("**/api/day?*", (route) => route.fulfill({ status: 503, json: { error: "Day offline" } }));
  await page.locator("#new-task").fill("Accepted new task");
  await page.locator("#new-task").press("Enter");
  await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: Accepted new task", exact: true })).toHaveValue("Accepted new task");
  await expect(page.locator(".app-error-toast")).toContainText("Your change was saved");
});

for (const destination of ["Today", "Log"] as const) {
  for (const failure of [false, true]) {
    test(`${destination} ignores a held pre-mutation day ${failure ? "failure" : "response"}`, async ({ page }) => {
      const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
      await page.clock.install();
      await openToday(page);
      if (destination === "Log") {
        await page.locator('[data-nav-id="day"]').click();
        await page.getByRole("radio", { name: "Timeline", exact: true }).click();
        await expect(page.getByRole("button", { name: "Add time block", exact: true })).toBeEnabled();
      }
      const held = barrier();
      const release = barrier();
      const delivered = barrier();
      const fresh = barrier();
      let requests = 0;
      await page.route("**/api/day?*", async (route) => {
        requests++;
        if (requests !== 1) {
          const response = await route.fetch();
          const json = await response.json();
          expect(destination === "Today" ? json.tasks : json.timeBlocks).toEqual(expect.arrayContaining([
            expect.objectContaining({ title: destination === "Today" ? "New day task" : "New day block" })
          ]));
          await route.fulfill({ response, json });
          fresh.release();
          return;
        }
        const response = await route.fetch();
        const json = await response.json();
        held.release();
        await release.promise;
        await route.fulfill(failure ? { status: 503, json: { error: "Old day failure" } } : { response, json });
        delivered.release();
      });
      await page.clock.pauseAt(new Date(`${todayKey}T23:59:58`));
      await page.clock.fastForward(3_000);
      await held.promise;
      if (destination === "Today") {
        await page.locator("#new-task").fill("New day task");
        await page.locator("#new-task").press("Enter");
        await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: New day task", exact: true })).toHaveValue("New day task");
        await fresh.promise;
        await expect(page.locator("#new-task")).toHaveValue("");
        // Pending ends only after the post-mutation day read has rendered.
        await expect(page.locator(".today-page").getByRole("button", { name: "Add", exact: true })).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Add time block", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add time block", exact: true });
        await dialog.getByLabel("Title", { exact: true }).fill("New day block");
        await dialog.getByLabel("Start", { exact: true }).fill("10:00");
        await dialog.getByLabel("End", { exact: true }).fill("10:30");
        await dialog.getByRole("button", { name: "Add block", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Time block: New day block/ })).toBeVisible();
      }
      await fresh.promise;
      const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/day");
      release.release();
      await delivered.promise;
      await (await staleResponse).finished();
      // A browser turn after delivery lets the decoded stale response reach the owner.
      await page.clock.runFor(32);
      if (destination === "Today") {
        await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: New day task", exact: true })).toHaveValue("New day task");
      } else {
        await expect(page.locator(".day-page").getByRole("button", { name: /Time block: New day block/ })).toBeVisible();
      }
      await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
      expect(requests).toBe(2);
    });
  }
}


test("Today and current Log load on entry; inactive days do not refresh", async ({ page }) => {
  const reads: string[] = [];
  await page.route("**/api/day?*", async (route) => {
    reads.push(new URL(route.request().url()).searchParams.get("date")!);
    await route.continue();
  });
  await openToday(page);
  expect(reads).toHaveLength(1);
  await page.locator('[data-nav-id="backlog"]').click();
  await expect(page.locator(".backlog-page")).toBeVisible();
  let bootstraps = 0;
  await page.route("**/api/bootstrap", async (route) => { bootstraps++; await route.continue(); });
  // A capture remains in Backlog through the mutation and awaited refresh.
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Search or add", exact: true });
  await palette.getByRole("option", { name: /Log an activity by hand/ }).click();
  const dialog = page.getByRole("dialog", { name: /Log activity/i });
  await dialog.getByLabel("Activity note", { exact: true }).fill("Mutation while day reads are inactive");
  const refreshed = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/bootstrap" && response.request().method() === "GET"
  );
  await dialog.getByRole("button", { name: "Add activity", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Capture closes the dialog before awaiting refresh; wait for its bootstrap
  // response to finish before checking inactive reads or changing destination.
  const response = await refreshed;
  expect(response.ok()).toBe(true);
  await response.finished();
  await expect(page.locator(".backlog-page")).toBeVisible();
  expect(bootstraps).toBe(1);
  expect(reads).toHaveLength(1);
  await page.locator('[data-nav-id="day"]').click();
  await expect.poll(() => reads.length).toBe(2);
  await expect(page.getByLabel("Day shown in Log")).toBeEnabled();
  expect(reads[1]).toBe(reads[0]);
  await page.locator('[data-nav-id="today"]').click();
  await expect(page.locator(".today-page")).toBeVisible();
  expect(reads).toHaveLength(3);
});

test("current Log exposes a failed day read and retries it", async ({ page }) => {
  await openToday(page);
  let fail = true;
  await page.route("**/api/day?*", (route) => fail
    ? route.fulfill({ status: 503, json: { error: "Day offline" } })
    : route.continue());
  await page.locator('[data-nav-id="day"]').click();
  await expect(page.locator(".day-page").getByRole("alert")).toContainText("That day could not be loaded");
  fail = false;
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".day-page").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Day shown in Log")).toBeEnabled();
});

test("Today's navigation count survives every inactive destination and historical Log", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  expect((await page.request.post("/api/tasks", { data: { title: "Counted today", date: todayKey } })).ok()).toBe(true);
  const yesterday = new Date(`${todayKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const pastKey = yesterday.toLocaleDateString("en-CA");
  expect((await page.request.post("/api/tasks", { data: { title: "Earlier task", date: pastKey } })).ok()).toBe(true);
  await openToday(page);
  const badge = page.locator('[data-nav-id="today"] small');
  await expect(badge).toHaveText("1");
  for (const destination of ["backlog", "journal", "projects", "review", "day"]) {
    await page.locator(`[data-nav-id="${destination}"]`).click();
    await expect(page.locator(destination === "day" ? ".day-page" : `.${destination}-page`)).toBeVisible();
    if (destination === "review") await expect(page.locator("#review-narrative")).toBeVisible();
    if (destination === "day") {
      const read = page.waitForResponse((response) => response.url().endsWith(`/api/day?date=${pastKey}`));
      await page.getByLabel("Day shown in Log").fill(pastKey);
      expect((await read).ok()).toBe(true);
      await expect(page.getByLabel("Day shown in Log")).toHaveValue(pastKey);
      await expect(page.getByLabel("Day shown in Log")).toBeEnabled();
    }
    await expect(badge).toHaveText("1");
  }
});

test("Focus pause and resume each refresh bootstrap and the active Today read", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  expect((await page.request.post("/api/focus-session", {
    data: { kind: "FOCUS", plannedMinutes: 25, label: "Coarse refresh focus" }
  })).ok()).toBe(true);
  await openToday(page);
  const reads: string[] = [];
  for (const path of ["bootstrap", "day?*"]) {
    await page.route(`**/api/${path}`, async (route) => {
      reads.push(new URL(route.request().url()).pathname);
      await route.continue();
    });
  }
  const rail = page.getByRole("complementary", { name: "Focus rail", exact: true });
  for (const [index, action] of ["Pause", "Resume"].entries()) {
    const title = `${action} refresh marker`;
    expect((await page.request.post("/api/tasks", { data: { title, date: todayKey } })).ok()).toBe(true);
    await rail.getByRole("button", { name: action, exact: true }).click();
    // Neither Focus's accepted snapshot nor the task-create handler can supply
    // this out-of-band task: both read owners must have published fresh data.
    await expect(page.locator(".today-page").getByRole("textbox", { name: `Task title: ${title}`, exact: true })).toHaveValue(title);
    await expect(page.locator('[data-nav-id="today"] small')).toHaveText(String(index + 1));
    expect(reads.filter((path) => path === "/api/bootstrap")).toHaveLength(index + 1);
    expect(reads.filter((path) => path === "/api/day")).toHaveLength(index + 1);
  }
});

test("starting the next queued task refreshes again after enrichment's reads have finished", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  const taskResponse = await page.request.post("/api/tasks", { data: { title: "Next queued task", date: null } });
  expect(taskResponse.ok()).toBe(true);
  const queued = await taskResponse.json();
  expect((await page.request.post("/api/focus-queue", { data: { taskId: queued.id, placement: "end" } })).ok()).toBe(true);
  const start = await page.request.post("/api/focus-session", {
    data: { kind: "FOCUS", plannedMinutes: 25, label: "Before queued task" }
  });
  expect(start.ok()).toBe(true);
  const { session } = await start.json();
  setFocusSessionElapsedMinutes(session.id, 3);
  await openToday(page);
  const rail = page.getByRole("complementary", { name: "Focus rail", exact: true });
  await rail.getByRole("button", { name: "Remove Break — stand up from queue", exact: true }).click();
  const bootstraps: Array<{ tasks: Array<{ id: string; focusQueuePosition: number | null }> }> = [];
  let days = 0;
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    bootstraps.push(json);
    await route.fulfill({ response, json });
  });
  await page.route("**/api/day?*", async (route) => { days++; await route.continue(); });
  async function seedMarker(title: string) {
    expect((await page.request.post("/api/tasks", { data: { title, date: todayKey } })).ok()).toBe(true);
  }
  async function expectMarker(title: string, count: number) {
    await expect(page.locator(".today-page").getByRole("textbox", { name: `Task title: ${title}`, exact: true })).toHaveValue(title);
    await expect(page.locator('[data-nav-id="today"] small')).toHaveText(String(count));
    expect(bootstraps).toHaveLength(count);
    expect(days).toBe(count);
  }
  await seedMarker("Completion marker");
  await rail.getByRole("button", { name: /^Finish( \d+m)?$/ }).click();
  await expectMarker("Completion marker", 1);
  const held = barrier();
  const release = barrier();
  await page.route("**/api/focus-session", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held.release();
    // Hold before the server commits, so enrichment must read the old queue.
    await release.promise;
    await route.continue();
  });
  await seedMarker("Enrichment marker");
  try {
    await rail.getByRole("button", { name: "Continue to Next queued task", exact: true }).click();
    await held.promise;
    await expectMarker("Enrichment marker", 2);
    expect(bootstraps[1].tasks.find((task) => task.id === queued.id)?.focusQueuePosition).toBe(0);
    await seedMarker("Queue start marker");
    release.release();
    await expect(rail.getByRole("heading", { name: queued.title, exact: true })).toBeVisible();
    await expectMarker("Queue start marker", 3);
    expect(bootstraps[2].tasks.find((task) => task.id === queued.id)?.focusQueuePosition).toBeNull();
    await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
  } finally {
    release.release();
  }
});

for (const malformed of [false, true]) {
  test(`Today's attempted title survives ${malformed ? "a malformed 200" : "a failed save"} until a newer day read`, async ({ page }) => {
    const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
    const task = await (await page.request.post("/api/tasks", {
      data: { title: "Original coarse title", date: todayKey }
    })).json();
    const now = new Date(`${todayKey}T12:00:00`);
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await openToday(page);
    let attempts = 0;
    await page.route(`**/api/tasks/${task.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts++;
      await route.fulfill(malformed
        ? { status: 200, json: { ok: true } }
        : { status: 500, json: { error: "Save failed" } });
    });
    // Keep a pre-edit coarse read in flight to exercise the same generation owner.
    const held = barrier();
    const release = barrier();
    await page.route("**/api/day?*", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      held.release();
      await release.promise;
      await route.fulfill({ response, json });
    });
    await page.locator("#new-task").fill("Trigger a held day read");
    await page.locator("#new-task").press("Enter");
    await held.promise;
    const row = (title: string) => page.locator(".today-page").getByRole("article", { name: `Task: ${title}`, exact: true });
    const originalInput = row(task.title).getByRole("textbox", { name: `Task title: ${task.title}`, exact: true });
    // Invalid drafts and ordinary typing must leave the original locator usable.
    await originalInput.fill("");
    await originalInput.press("Enter");
    await page.clock.runFor(600);
    expect(attempts).toBe(0);
    await expect(originalInput).toHaveValue("");
    await originalInput.fill("  Attempted coarse title  ");
    await originalInput.press("Enter");
    await expect.poll(() => attempts).toBe(1);
    const attempted = row("Attempted coarse title");
    await expect(attempted).toBeVisible();
    await expect(attempted.getByRole("button", { name: "Complete Attempted coarse title", exact: true })).toBeVisible();
    await page.clock.runFor(1000);
    await expect.poll(() => attempts).toBe(2);
    await page.clock.runFor(4000);
    await expect.poll(() => attempts).toBe(3);
    await expect(attempted.locator(".save-state-chip.error")).toContainText("Not saved");
    await page.clock.runFor(10_000);
    await expect(attempted.getByRole("textbox", { name: "Task title: Attempted coarse title", exact: true })).toHaveValue("  Attempted coarse title  ");
    expect(attempts).toBe(3);

    const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/day");
    release.release();
    await (await staleResponse).finished();
    await page.clock.runFor(100);
    await expect(attempted.locator(".save-state-chip.error")).toContainText("Not saved");
    await page.unroute("**/api/day?*");

    // A failed coarse refresh must preserve the attempted title throughout the error state.
    await page.route("**/api/day?*", (route) => route.fulfill({ status: 503, json: { error: "Day offline" } }));
    await page.locator("#new-task").fill("Trigger a failed day refresh");
    await page.locator("#new-task").press("Enter");
    await expect(page.getByRole("button", { name: "Retry day", exact: true })).toBeVisible();
    await expect(attempted.locator(".save-state-chip.error")).toContainText("Not saved");

    // APIRequestContext bypasses page routing: install a newer canonical value.
    expect((await page.request.patch(`/api/tasks/${task.id}`, {
      data: { title: "Newer canonical title" }
    })).ok()).toBe(true);
    await page.unroute("**/api/day?*");
    await page.getByRole("button", { name: "Retry day", exact: true }).click();
    const fresh = row("Newer canonical title");
    await expect(fresh).toBeVisible();
    await expect(attempted).toHaveCount(0);
    await expect(fresh.getByRole("textbox", { name: "Task title: Newer canonical title", exact: true })).toHaveValue("  Attempted coarse title  ");
    await expect(fresh.locator(".save-state-chip.error")).toContainText("Not saved");

    // An unrelated optimistic edit merges into the current day task, not a stale bootstrap task.
    await fresh.getByRole("button", { name: "Show task details: Newer canonical title", exact: true }).click();
    await fresh.getByRole("radio", { name: "Very urgent", exact: true }).click();
    await expect.poll(() => attempts).toBe(4);
    await expect(fresh).toBeVisible();
    await expect(attempted).toHaveCount(0);
  });
}

test("a truncated successful day task shows read failure and can be retried", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  await page.request.post("/api/tasks", { data: { title: "Complete day contract", date: todayKey } });
  await page.route("**/api/day?*", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.tasks = json.tasks.map(({ id, title, date, status }: { id: string; title: string; date: string | null; status: string }) => ({ id, title, date, status }));
    await route.fulfill({ response, json });
  });
  await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await expect(page.locator(".app-shell").getByRole("alert")).toContainText("That day could not be loaded");
  await expect(page.locator(".today-page")).toHaveCount(0);
  await page.unroute("**/api/day?*");
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".today-page").getByRole("article", { name: "Task: Complete day contract", exact: true })).toBeVisible();
});

test("a truncated day activity shows read failure; retry restores Today content and Log editing", async ({ page }) => {
  // Today's captured list is visible inside the page in the compact layout.
  await page.setViewportSize({ width: 1100, height: 900 });
  const note = "Complete activity contract";
  const created = await page.request.post("/api/activities", {
    data: { startTime: "09:00", durationMinutes: 20, category: "Research", note }
  });
  expect(created.status()).toBe(201);
  await page.route("**/api/day?*", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    expect(json.activities).toHaveLength(1);
    json.activities = json.activities.map(({ id, startedAt, durationMinutes }: {
      id: string; startedAt: string; durationMinutes: number;
    }) => ({ id, startedAt, durationMinutes }));
    await route.fulfill({ response, json });
  });
  await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await expect(page.locator(".app-shell").getByRole("alert")).toContainText("That day could not be loaded");
  await expect(page.locator(".today-page")).toHaveCount(0);
  await page.unroute("**/api/day?*");
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".today-page").getByText(note, { exact: true })).toBeVisible();
  await expect(page.locator(".today-page").getByText("20m · Research", { exact: true })).toBeVisible();
  await page.locator('[data-nav-id="day"]').click();
  await page.getByRole("radio", { name: "Stream", exact: true }).click();
  await page.getByRole("button", { name: `Edit activity: ${note}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit activity", exact: true });
  await expect(dialog.getByLabel("Activity note", { exact: true })).toHaveValue(note);
  await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue("Research");
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("20");
});
