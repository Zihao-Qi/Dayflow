import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openDataAndBackups(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
    timeout: 30_000
  });
  // On phone layouts the sidebar is replaced by the bottom tab bar, and
  // Data & backups moves behind More.
  const sidebarOpener = page.getByRole("button", {
    name: "Data & backups",
    exact: true
  });
  if (!(await sidebarOpener.isVisible())) {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("menu", { name: "More destinations" })
      .getByRole("menuitem", { name: "Data & backups" })
      .click();
  } else {
    await sidebarOpener.click();
  }
  const dialog = page.getByRole("dialog", {
    name: "Data & backups",
    exact: true
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

const panel = (page: Page) =>
  page.getByRole("region", { name: "Automatic backups" });

test("automatic backups are off until deliberately enabled", async ({ page }) => {
  const dialog = await openDataAndBackups(page);
  const section = panel(page);
  await expect(section).toBeVisible();
  await expect(section.getByText("Off", { exact: true })).toBeVisible();
  await expect(section.getByText("Not scheduled")).toBeVisible();

  // The schedule fields stay inert while the feature is off.
  await expect(dialog.getByLabel("Every")).toBeDisabled();
  await expect(dialog.getByLabel("Keep")).toBeDisabled();
});

test("enabling schedules automatic backups and states that nothing is deleted", async ({
  page
}) => {
  await openDataAndBackups(page);
  const section = panel(page);

  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/backups/automatic" &&
      response.request().method() === "PUT"
  );
  await section.getByRole("checkbox").check();
  expect((await saved).status()).toBe(200);

  await expect(section.getByText("On", { exact: true })).toBeVisible();
  await expect(section.getByText("As soon as Dayflow checks")).toBeVisible();
  await expect(
    section.getByText(/It never deletes a backup/)
  ).toBeVisible();
  await expect(page.getByLabel("Every")).toBeEnabled();
});

test("the policy survives reopening the dialog", async ({ page }) => {
  const dialog = await openDataAndBackups(page);
  await panel(page).getByRole("checkbox").check();
  await expect(panel(page).getByText("On", { exact: true })).toBeVisible();

  await page.getByLabel("Close data and backups").click();
  await expect(dialog).toBeHidden();

  await page
    .getByRole("button", { name: "Data & backups", exact: true })
    .click();
  await expect(panel(page).getByText("On", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("checkbox")).toBeChecked();
});

test("a rejected policy change surfaces without leaking internals", async ({
  page
}) => {
  await openDataAndBackups(page);
  await page.route("**/api/backups/automatic", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 400,
      json: {
        error: "The backup interval in hours must be a whole number between 1 and 168.",
        code: "VALIDATION_ERROR",
        field: "intervalHours"
      }
    });
  });

  // Not check(): it re-reads the checkbox after clicking and fails if it is no
  // longer checked. The panel toggles optimistically and reverts when the
  // mocked 400 arrives, so on a slow runner the revert lands before that
  // re-read. Click, then assert the rejection round trip and the rollback.
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/backups/automatic" &&
      response.request().method() === "PUT"
  );
  const toggle = panel(page).getByRole("checkbox");
  await toggle.click();
  expect((await rejected).status()).toBe(400);
  const message = page.getByText(/must be a whole number between 1 and 168/);
  await expect(message).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/sqlite|prisma/i)).toHaveCount(0);
});

test("the automatic backup controls fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDataAndBackups(page);
  const section = panel(page);
  await expect(section).toBeVisible();

  const toggle = section.getByRole("checkbox");
  const box = await section
    .locator(".automatic-backup-toggle")
    .boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await toggle.check();
  await expect(section.getByText("On", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    )
  ).toBe(false);
});

test("interval and retention edits send the complete policy and display the returned next due time", async ({ page }) => {
  const initialResponse = await page.request.get("/api/backups");
  expect(initialResponse.ok()).toBe(true);
  const index = await initialResponse.json();
  const lastSuccessAt = "2026-09-04T12:00:00.000Z";
  let automatic = {
    ...index.automatic,
    policy: { enabled: true, intervalHours: 24, retainCount: 7 },
    lastSuccessAt,
    schedule: { due: false, nextDueAt: "2026-09-05T12:00:00.000Z" }
  };
  await page.route("**/api/backups", (route) => route.fulfill({
    status: 200, json: { ...index, automatic }
  }));
  const policies: unknown[] = [];
  await page.route("**/api/backups/automatic", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-dayflow-local-action"]).toBe("1");
    const policy = route.request().postDataJSON();
    policies.push(policy);
    automatic = {
      ...automatic,
      policy,
      schedule: {
        due: false,
        nextDueAt: new Date(Date.parse(lastSuccessAt) + policy.intervalHours * 3_600_000).toISOString()
      },
      retention: { automaticCount: 9, retainCount: policy.retainCount, beyondRetention: 9 - policy.retainCount }
    };
    await route.fulfill({ status: 200, json: automatic });
  });
  await openDataAndBackups(page);
  const section = panel(page);
  await section.getByLabel("Every").selectOption("72");
  await expect.poll(() => policies.length).toBe(1);
  expect(policies[0]).toEqual({ enabled: true, intervalHours: 72, retainCount: 7 });
  const nextDue = await page.evaluate(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date("2026-09-07T12:00:00.000Z")));
  await expect(section.locator(".automatic-backup-facts > div").filter({ hasText: "Next due" }).locator("dd")).toHaveText(nextDue);
  await section.getByLabel("Keep").fill("3");
  await expect.poll(() => policies.length).toBe(2);
  expect(policies[1]).toEqual({ enabled: true, intervalHours: 72, retainCount: 3 });
  await expect(section.locator(".automatic-backup-retention")).toContainText("6 automatic copies are beyond the 3 you asked to keep.");
  await expect(section.locator(".automatic-backup-retention")).toContainText("Dayflow has not deleted anything.");
  await page.getByLabel("Close data and backups").click();
  await page.getByRole("button", { name: "Data & backups", exact: true }).click();
  await expect(section.getByLabel("Every")).toHaveValue("72");
  await expect(section.getByLabel("Keep")).toHaveValue("3");
  await expect(section.locator(".automatic-backup-facts > div").filter({ hasText: "Next due" }).locator("dd")).toHaveText(nextDue);
});
