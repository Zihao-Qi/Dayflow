import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, seedPastReviews } from "./database";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function openReview(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await page.locator('[data-nav-id="review"]').click();
  await expect(page.locator("#review-narrative")).toBeVisible();
}
test.beforeEach(() => resetTestDatabase());

test("Review waits for the current window and retries an initial failure", async ({ page }) => {
  const held = barrier();
  const release = barrier();
  let reads = 0;
  let retry = false;
  await page.route("**/api/review/window?current=1", async (route) => {
    reads++;
    // Next's development Strict Mode replays mount effects. Hold/fail every
    // entry read so a replay cannot bypass the initial-failure barrier.
    if (retry) return route.continue();
    held.release();
    await release.promise;
    await route.fulfill({ status: 503, json: { error: "Window offline" } });
  });
  await page.goto("/");
  await page.locator('[data-nav-id="review"]').click();
  await held.promise;
  await expect(page.getByText("Loading current Review…", { exact: true })).toBeVisible();
  await expect(page.locator("#review-narrative")).toHaveCount(0);
  release.release();
  await expect(page.locator(".review-page").getByRole("alert")).toBeVisible();
  const entryReads = reads;
  retry = true;
  await page.getByRole("button", { name: "Retry Review", exact: true }).click();
  await expect(page.locator("#review-narrative")).toHaveValue("");
  expect(reads).toBe(entryReads + 1);
});

for (const failure of [false, true]) {
  test(`Review ignores a held pre-mutation current window ${failure ? "failure" : "response"}`, async ({ page }) => {
    const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
    await page.clock.install();
    await openReview(page);
    const held = barrier();
    const release = barrier();
    const delivered = barrier();
    const fresh = barrier();
    let reads = 0;
    await page.route("**/api/review/window?current=1", async (route) => {
      reads++;
      if (reads !== 1) {
        const response = await route.fetch();
        const json = await response.json();
        expect(json.review.narrative).toBe("Writing after held window");
        await route.fulfill({ response, json });
        fresh.release();
        return;
      }
      const response = await route.fetch();
      const json = await response.json();
      held.release();
      await release.promise;
      await route.fulfill(failure ? { status: 503, json: { error: "Old window failure" } } : { response, json });
      delivered.release();
    });
    await page.clock.pauseAt(new Date(`${todayKey}T23:59:58`));
    await page.clock.fastForward(3_000);
    await held.promise;
    await page.locator("#review-narrative").fill("Writing after held window");
    await page.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(page.locator(".review-page").getByText("Saved", { exact: true })).toBeVisible();
    await fresh.promise;
    const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/review/window");
    release.release();
    await delivered.promise;
    await (await staleResponse).finished();
    await page.clock.runFor(32);
    await expect(page.locator("#review-narrative")).toHaveValue("Writing after held window");
    await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
    expect(reads).toBe(2);
  });
}

test("a failed current window refresh preserves accepted writing and reports saved-refresh-failed", async ({ page }) => {
  await openReview(page);
  await page.route("**/api/review/window?current=1", (route) => route.fulfill({ status: 503, json: { error: "Window offline" } }));
  await page.locator("#review-narrative").fill("Accepted writing");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.locator(".app-error-toast")).toContainText("Your change was saved");
  await expect(page.locator("#review-narrative")).toHaveValue("Accepted writing");
  await expect(page.locator(".review-page").getByText("Saved", { exact: true })).toBeVisible();
});

test("bootstrap failure still attempts the current Review window", async ({ page }) => {
  await openReview(page);
  let reads = 0;
  await page.route("**/api/review/window?current=1", async (route) => { reads++; await route.continue(); });
  await page.route("**/api/bootstrap", (route) => route.fulfill({ status: 503, json: { error: "Bootstrap offline" } }));
  await page.locator("#review-narrative").fill("Saved with a failed base read");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.locator(".app-error-toast")).toContainText("Your change was saved");
  expect(reads).toBe(1);
});

for (const selection of ["saved period", "window"] as const) {
  test(`a confirmed mutation refreshes Review history and its selected ${selection} without changing selection`, async ({ page }) => {
    seedPastReviews([3]);
    await openReview(page);
    await page.getByRole("button", { name: "Earlier reviews", exact: true }).click();
    const panel = page.getByRole("region", { name: "Earlier reviews", exact: true });
    if (selection === "saved period") {
      await panel.getByRole("button", { name: /Saved 3 days ago/ }).click();
    } else {
      const { todayKey } = await (await page.request.get("/api/bootstrap")).json();
      const ending = new Date(`${todayKey}T12:00:00`);
      ending.setDate(ending.getDate() - 3);
      await panel.getByLabel("Review window ending").fill(ending.toLocaleDateString("en-CA"));
      await panel.getByRole("button", { name: "Open window", exact: true }).click();
    }
    await expect(page.locator(".review-past-card")).toContainText("Saved 3 days ago");
    const heading = await page.locator(".page-eyebrow").textContent();
    const reads: string[] = [];
    await page.route("**/api/review/**", async (route) => {
      reads.push(route.request().url());
      await route.continue();
    });
    // A global capture is a confirmed mutation while historical Review is active.
    await page.getByRole("button", { name: /Search or add/ }).click();
    const palette = page.getByRole("dialog", { name: "Search or add", exact: true });
    await palette.getByRole("option", { name: /Log an activity by hand/ }).click();
    const dialog = page.getByRole("dialog", { name: /Log activity/i });
    await dialog.getByLabel("Activity note", { exact: true }).fill("Refresh historical evidence");
    await dialog.getByRole("button", { name: "Add activity", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => reads.some((url) => url.includes("current=1"))).toBe(true);
    await expect.poll(() => reads.some((url) => url.includes("/history?"))).toBe(true);
    await expect.poll(() => reads.some((url) => selection === "window" ? url.includes("ending=") : /\/api\/review\/[^/?]+$/.test(url))).toBe(true);
    await expect(page.locator(".page-eyebrow")).toHaveText(heading!);
    await expect(page.locator(".review-past-card")).toContainText("Saved 3 days ago");
  });
}

test("a saving caller follows a newer whole refresh after one earlier required read failed", async ({ page }) => {
  await page.clock.install();
  await openReview(page);
  const held = barrier();
  const release = barrier();
  const delivered = barrier();
  let bootstraps = 0;
  let windows = 0;
  await page.route("**/api/bootstrap", async (route) => {
    bootstraps++;
    if (bootstraps !== 1) return route.continue();
    const response = await route.fetch();
    held.release();
    await release.promise;
    await route.fulfill({ response });
    delivered.release();
  });
  await page.route("**/api/review/window?current=1", async (route) => {
    windows++;
    if (windows === 1) return route.fulfill({ status: 503, json: { error: "Earlier partial failure" } });
    await route.continue();
  });
  await page.locator("#review-narrative").fill("Follow the fresh outcome");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await held.promise;
  await page.getByRole("button", { name: "Retry Review", exact: true }).click();
  await expect(page.locator(".review-page").getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
  const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bootstrap");
  release.release();
  await delivered.promise;
  await (await staleResponse).finished();
  await page.clock.runFor(32);
  await expect(page.locator("#review-narrative")).toHaveValue("Follow the fresh outcome");
  await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
  expect(bootstraps).toBe(2);
  expect(windows).toBe(2);
});

test("inactive Review loads fresh evidence on each entry", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/review/window?current=1", async (route) => { reads++; await route.continue(); });
  await openReview(page);
  const entryReads = reads;
  expect(entryReads).toBeGreaterThan(0);
  await page.locator('[data-nav-id="today"]').click();
  await expect(page.locator(".today-page")).toBeVisible();
  await page.locator("#new-task").fill("Mutation while Review is inactive");
  await page.locator("#new-task").press("Enter");
  await expect(page.locator("#new-task")).toHaveValue("");
  await expect(page.locator(".today-page").getByRole("button", { name: "Add", exact: true })).toBeVisible();
  expect(reads).toBe(entryReads);
  await page.locator('[data-nav-id="review"]').click();
  await expect(page.locator("#review-narrative")).toBeVisible();
  expect(reads).toBeGreaterThan(entryReads);
});

test("save recovery cannot clear a newer saved-but-refresh-failed warning", async ({ page }) => {
  await openReview(page);
  let recover = false;
  let attempts = 0;
  await page.route("**/api/review", async (route) => {
    attempts++;
    if (!recover) return route.fulfill({ status: 503, json: { error: "Save unavailable" } });
    await route.continue();
  });
  await page.locator("#review-narrative").fill("Recover the save and keep refresh feedback");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect.poll(() => attempts, { timeout: 15_000 }).toBe(3);
  const retry = page.locator(".review-save-state").getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  recover = true;
  await page.route("**/api/review/window?current=1", (route) => route.fulfill({ status: 503, json: { error: "Refresh unavailable" } }));
  await retry.click();
  await expect(page.locator(".review-page").getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".app-error-toast")).toContainText("Your change was saved");
  await expect(page.locator("#review-narrative")).toHaveValue("Recover the save and keep refresh feedback");
});
