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

  await panel(page).getByRole("checkbox").check();
  const message = page.getByText(/must be a whole number between 1 and 168/);
  await expect(message).toBeVisible();
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
