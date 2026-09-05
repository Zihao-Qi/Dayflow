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
    let requests = 0;
    await page.route("**/api/bootstrap", async (route) => {
      requests += 1;
      if (requests !== 1) return route.continue();
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
    await expect(page.locator(".next-section .task-row")).toContainText("Saved after held bootstrap");
    await expect(page.locator(".today-page button").filter({ hasText: /^Add$/ })).toBeDisabled();
    release.release();
    await delivered.promise;
    // Navigation and the palette also check retained bootstrap consumers.
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await page.getByRole("button", { name: "Today", exact: true }).first().click();
    await expect(page.locator(".next-section .task-row")).toContainText("Saved after held bootstrap");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "Search or add", exact: true });
    await palette.getByRole("combobox").fill("Saved after held bootstrap");
    await expect(palette.getByRole("option").filter({ hasText: "Saved after held bootstrap" }).first()).toBeVisible();
    expect(requests).toBe(2);
  });
}
