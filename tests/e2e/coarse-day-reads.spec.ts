import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

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
  await expect(page.getByRole("alert")).toContainText("That day could not be loaded");
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".today-page")).toBeVisible();
  expect(requests).toBe(2);
});

test("bootstrap failure still refreshes Today after a saved mutation", async ({ page }) => {
  await openToday(page);
  await page.route("**/api/bootstrap", (route) => route.fulfill({ status: 503, json: { error: "Bootstrap offline" } }));
  await page.locator("#new-task").fill("Saved despite bootstrap failure");
  await page.locator("#new-task").press("Enter");
  await expect(page.locator(".next-section .task-row")).toContainText("Saved despite bootstrap failure");
  await expect(page.getByRole("alert")).toContainText("Your change was saved");
});

test("a failed day refresh keeps an accepted task create visible with saved-refresh-failed feedback", async ({ page }) => {
  const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
  await page.request.post("/api/tasks", { data: { title: "Accepted task", date: todayKey } });
  await openToday(page);
  await page.route("**/api/day?*", (route) => route.fulfill({ status: 503, json: { error: "Day offline" } }));
  await page.locator("#new-task").fill("Accepted new task");
  await page.locator("#new-task").press("Enter");
  await expect(page.locator(".next-section .task-row")).toContainText("Accepted new task");
  await expect(page.locator(".app-error-toast")).toContainText("Your change was saved");
});

for (const destination of ["Today", "Log"] as const) {
  for (const failure of [false, true]) {
    test(`${destination} ignores a held pre-mutation day ${failure ? "failure" : "response"}`, async ({ page }) => {
      const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
      await page.clock.install();
      await openToday(page);
      if (destination === "Log") {
        await page.getByRole("button", { name: "Log", exact: true }).click();
        await page.getByRole("radio", { name: "Timeline", exact: true }).click();
        await expect(page.getByRole("button", { name: "Add time block", exact: true })).toBeEnabled();
      }
      const held = barrier();
      const release = barrier();
      const delivered = barrier();
      let requests = 0;
      await page.route("**/api/day?*", async (route) => {
        requests++;
        if (requests !== 1) return route.continue();
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
        await expect(page.locator(".next-section .task-row")).toContainText("New day task");
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
      release.release();
      await delivered.promise;
      // A browser turn after delivery lets the decoded stale response reach the owner.
      await page.clock.runFor(32);
      await expect(page.locator(destination === "Today" ? ".next-section .task-row" : ".day-page")).toContainText(destination === "Today" ? "New day task" : "New day block");
      await expect(page.getByRole("alert")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
  await expect(page.locator(".backlog-page")).toBeVisible();
  expect(reads).toHaveLength(1);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect.poll(() => reads.length).toBe(2);
  await expect(page.getByLabel("Day shown in Log")).toBeEnabled();
  expect(reads[1]).toBe(reads[0]);
  await page.getByRole("button", { name: "Today", exact: true }).first().click();
  await expect(page.locator(".today-page")).toBeVisible();
  expect(reads).toHaveLength(3);
});

test("current Log exposes a failed day read and retries it", async ({ page }) => {
  await openToday(page);
  let fail = true;
  await page.route("**/api/day?*", (route) => fail
    ? route.fulfill({ status: 503, json: { error: "Day offline" } })
    : route.continue());
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator(".day-page").getByRole("alert")).toContainText("That day could not be loaded");
  fail = false;
  await page.getByRole("button", { name: "Retry day", exact: true }).click();
  await expect(page.locator(".day-page").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Day shown in Log")).toBeEnabled();
});
