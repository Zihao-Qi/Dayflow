import { expect, test } from "@playwright/test";
import { resetTestDatabase } from "./database";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test.beforeEach(() => resetTestDatabase());

for (const failure of [false, true]) {
  test(`a pre-mutation bootstrap ${failure ? "failure" : "response"} cannot roll back a newer refresh`, async ({ page }) => {
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    await page.addInitScript(() => localStorage.setItem("dayflow-first-run-seen", "1"));
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator(".today-page")).toBeVisible();
    const held = barrier();
    const release = barrier();
    const delivered = barrier();
    const fresh = barrier();
    let requests = 0;
    await page.route("**/api/bootstrap", async (route) => {
      requests += 1;
      if (requests !== 1) {
        const response = await route.fetch();
        const json = await response.json();
        expect(json.paletteTasks).toEqual(expect.arrayContaining([
          expect.objectContaining({ title: "Saved after held bootstrap" })
        ]));
        await route.fulfill({ response, json });
        fresh.release();
        return;
      }
      const response = await route.fetch();
      const json = await response.json();
      held.release();
      await release.promise;
      await route.fulfill(failure
        ? { status: 503, json: { error: "Old refresh failed", code: "INTERNAL_ERROR" } }
        : { response, json });
      delivered.release();
    });
    await page.clock.pauseAt(new Date(`${bootstrap.todayKey}T23:59:58`));
    await page.clock.fastForward(3_000);
    await held.promise;
    await page.locator("#new-task").fill("Saved after held bootstrap");
    await page.locator("#new-task").press("Enter");
    await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: Saved after held bootstrap", exact: true })).toHaveValue("Saved after held bootstrap");
    await fresh.promise;
    await expect(page.locator("#new-task")).toHaveValue("");
    await expect(page.locator(".today-page").getByRole("button", { name: "Add", exact: true })).toBeVisible();
    // The palette can only get this task from bootstrap B, not acceptTask or /api/day.
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "Search or add", exact: true });
    await palette.getByRole("combobox").fill("Saved after held bootstrap");
    await expect(palette.getByRole("option", { name: /Saved after held bootstrap.*Focus on/ })).toBeVisible();
    const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bootstrap");
    release.release();
    await delivered.promise;
    await (await staleResponse).finished();
    await page.clock.runFor(32);
    await expect(palette.getByRole("option", { name: /Saved after held bootstrap.*Focus on/ })).toBeVisible();
    await page.keyboard.press("Escape");
    // Navigation and the palette also check retained bootstrap consumers.
    await page.locator('[data-nav-id="day"]').click();
    await page.locator('[data-nav-id="today"]').click();
    await expect(page.locator(".today-page").getByRole("textbox", { name: "Task title: Saved after held bootstrap", exact: true })).toHaveValue("Saved after held bootstrap");
    await expect(page.locator(".app-shell").getByRole("alert")).toHaveCount(0);
    await expect(page.locator('[data-nav-id="today"] small')).toHaveText("1");
    expect(requests).toBe(2);
  });
}
